/**
Copyright (C) 2026 xTsuSaKu <me@xtsusaku.net> (https://xtsusaku.net)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/agpl-3.0.txt>.
*/
import { Readable } from "node:stream";
import BucketSystem from "./api/abs/BucketSystem";
import DefaultBucketSystem from "./api/default/DefaultBucketSystem";
import DefaultMetadataProvider from "./api/default/DefaultMetadataProvider";
import DefaultObjectSystem from "./api/default/DefaultObjectSystem";
import { S3Verifier } from "./api/S3Verifier";
import { S3Error } from "./api/S3Error";

type Internal<T> = T & {
  internal?: Record<string, any>;
};

export default class S3Server {
  private _baseHost: string[];
  private _iframeAllow: string[];
  private _metadataProviderClass: typeof DefaultMetadataProvider;
  private _metadataProviderOptions: any;
  private _objectSystemClass: typeof DefaultObjectSystem;
  private _objectSystemOptions: any;
  private _bucketSystem: BucketSystem;
  private _owner: S3Server.Owner;
  private _region: string;
  private _bucketSystems: Map<string, BucketSystem> = new Map();

  constructor({
    baseHost = [],
    iframeAllow = [],
    metadataProviderClass = DefaultMetadataProvider,
    metadataProviderOptions = { fileLocation: "./default_metadata.json" },
    objectSystemClass = DefaultObjectSystem,
    objectSystemOptions = {},
    owner = { id: "ASDSAFKNDKFJNSDV", displayName: "xTSK" },
    region = "us-east-1",
    bucketSystem = new DefaultBucketSystem(
      process.env.S3_SECRET_KEY || "A_KEY",
      region,
      metadataProviderClass,
      metadataProviderOptions,
      objectSystemClass,
      objectSystemOptions,
      "./buckets.json",
      owner,
    ),
  }: S3Server.S3ServerOptions) {
    this._baseHost = baseHost;
    this._iframeAllow = iframeAllow;
    this._metadataProviderClass = metadataProviderClass;
    this._metadataProviderOptions = metadataProviderOptions;
    this._objectSystemClass = objectSystemClass;
    this._objectSystemOptions = objectSystemOptions;
    this._owner = owner;
    this._region = region;
    this._bucketSystem = bucketSystem;
  }

  getErrorResponse(
    status: number,
    errorCode: string,
    message: string,
    requestId?: string,
  ) {
    return new Response(
      `<Error><Code>${errorCode}</Code><Message>${message}</Message></Error>`,
      {
        status,
        headers: {
          "x-amz-request-id": requestId || "",
          "content-security-policy": `frame-ancestors ${this._iframeAllow.join(" ") || "none"}`,
          "content-type": "application/xml",
        },
      },
    );
  }

  getAccessDeniedResponse(requestId: string) {
    return new Response(this._bucketSystem.getAccessDeniedResponse(requestId), {
      status: 403,
      headers: {
        "x-amz-request-id": requestId,
        "content-security-policy": `frame-ancestors ${this._iframeAllow.join(" ") || "none"}`,
        "content-type": "application/xml",
      },
    });
  }

  getResponse(
    responseInit: Internal<ResponseInit>,
    body: string | ReadableStream | ArrayBuffer | undefined,
  ): Response {
    delete responseInit.internal;

    return new Response(body, {
      ...responseInit,
      headers: {
        ...responseInit.headers,
      },
    });
  }

  async authenticateRequest(
    request: Request,
  ): Promise<
    | Response
    | Internal<ResponseInit & { headers: Record<string, string | number> }>
  > {
    const requestId = crypto.randomUUID();

    const isValid = await S3Verifier.mutateRequest(
      request,
      this._bucketSystem.getSecretKey(request),
    );
    const isTimeValid = S3Verifier.verifyTime(
      request.headers,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (!isValid || !isTimeValid) {
      return this.getAccessDeniedResponse(requestId);
    }

    return {
      headers: {
        "x-amz-request-id": requestId,
        "content-security-policy": `frame-ancestors 'self' ${this._iframeAllow.join(" ") || "none"}`,
      },
    };
  }

  async extractBucketName(
    request: Request,
    response: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
  ): Promise<
    | Response
    | Internal<ResponseInit & { headers: Record<string, string | number> }>
  > {
    const url = new URL(request.url);
    let host = url.host;
    for (const base of this._baseHost) {
      if (host.endsWith(base)) {
        host = host.slice(0, host.length - base.length);
        break;
      }
    }

    // Vhost pattern: bucket.s3.domain.com or bucket.domain.com
    const vhostMatch = host.match(/^([a-z0-9.-]+)\./);
    let bucket = null;

    if (vhostMatch && !url.pathname.startsWith("/")) {
      bucket = vhostMatch[1]; // Virtual-hosted style
    } else {
      // Path style: /bucket/key
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length > 0) bucket = pathParts[0];
    }

    return {
      ...response,
      internal: {
        bucket: bucket || "",
        owner: await this._bucketSystem.getOwner(request),
        isRootRequest: url.pathname === "/",
        isVirtualHostedStyle: !!vhostMatch,
      },
    };
  }

  async handleRequest(request: Request): Promise<Response> {
    const authResult = await this.authenticateRequest(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const bucketInfo = await this.extractBucketName(request, authResult);
    if (bucketInfo instanceof Response) {
      return bucketInfo;
    }

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const headers = Object.fromEntries(request.headers.entries());

    switch (request.method) {
      case "GET":
        return this.handleGet(request, bucketInfo, query, headers);
      // Handle other methods (PUT, POST, DELETE, etc.) similarly
      case "HEAD":
        return this.handleHead(request, bucketInfo);
      case "PUT":
        return this.handlePut(request, bucketInfo, query, headers);
      case "DELETE":
        return this.handleDelete(request, bucketInfo, query, headers);
      case "POST":
        return this.handlePost(request, bucketInfo, query, headers);
      default:
        return new Response("Method Not Allowed", { status: 405 });
    }
  }

  async handleGet(
    request: Request,
    responseInit: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
    query: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Response> {
    /**
     * List Buckets: GET / with no bucket specified
     */
    if (responseInit.internal?.isRootRequest) {
      const bucketXml = await this._bucketSystem.listsBucketsHandler({
        request,
        prefix: query.prefix as string | undefined,
        maxBuckets: query["max-keys"]
          ? parseInt(query["max-keys"].toString())
          : undefined,
        continuationToken: query["continuation-token"] as string | undefined,
      });
      responseInit.headers["content-type"] = "application/xml";
      return this.getResponse(responseInit, bucketXml as string);
    }

    const bucket = responseInit.internal?.bucket;
    if (!bucket) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        "Bad Request: Bucket name could not be determined",
      );
    }

    let path = responseInit.internal?.isVirtualHostedStyle
      ? request.url.replace(/^https?:\/\/[^/]+/, "") // Remove scheme and host
      : new URL(request.url).pathname.replace(
          new RegExp(`^(\/|)${bucket}`),
          "",
        );
    path = "/" + path.replace(/^\/+/, "");

    let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
    if (!objectSystem) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        `Bucket "${bucket}" not found`,
      );
    }

    /**
     * List Objects V2: GET /bucket?list-type=2
     */
    if (path === "/") {
      const {
        "list-type": listType,
        prefix,
        delimiter,
        "fetch-owner": fetchOwner,
        "max-keys": maxKeys,
        "continuation-token": continuationToken,
        "start-after": startAfter,
        "encoding-type": encodingType,
        "expected-bucket-owner": expectedBucketOwner,
      } = query;
      const listObjectsXml = await objectSystem.listObjectsV2Handler({
        listType,
        prefix,
        delimiter,
        fetchOwner: fetchOwner === "true",
        maxKeys: maxKeys ? parseInt(maxKeys.toString()) : undefined,
        continuationToken,
        startAfter,
        encodingType,
        expectedBucketOwner,
      });
      responseInit.headers["content-type"] = "application/xml";
      console.log(this.getResponse(responseInit, listObjectsXml as string));
      return this.getResponse(responseInit, listObjectsXml as string);
    }

    /**
     * Get Object: GET /bucket/key
     */
    const range = headers.Range || headers.range;
    path = decodeURIComponent(path);
    path = "/" + path.replace(/^\/+/, "");
    const objectMetadata = await objectSystem.getObject(
      decodeURIComponent(path),
      range,
    );
    if (objectMetadata.errorCode) {
      return this.getErrorResponse(
        objectMetadata.httpStatus || 404,
        objectMetadata.error || "ObjectNotFound",
        `Object "${path}" not found in bucket "${bucket}"`,
      );
    }

    responseInit.headers["content-length"] =
      objectMetadata.contentLength?.toString() || "0";
    responseInit.headers["last-modified"] = objectMetadata.lastModified
      ? new Date(objectMetadata.lastModified).toUTCString()
      : new Date().toUTCString();
    if (objectMetadata.eTag) {
      responseInit.headers["etag"] = `"${objectMetadata.eTag}"`;
    }
    if (range) responseInit.headers["accept-ranges"] = "bytes";
    if (objectMetadata.contentType)
      responseInit.headers["content-type"] =
        objectMetadata.contentType || "application/octet-stream";
    if (objectMetadata.data)
      return this.getResponse(
        responseInit,
        Readable.toWeb(
          Readable.from(objectMetadata.data),
        ) as unknown as ReadableStream,
      );
    else return this.getResponse(responseInit, undefined);
  }

  async handleHead(
    request: Request,
    responseInit: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
  ): Promise<Response> {
    const bucket = responseInit.internal?.bucket;
    if (!bucket) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        "Bad Request: Bucket name could not be determined",
      );
    }

    let path = responseInit.internal?.isVirtualHostedStyle
      ? request.url.replace(/^https?:\/\/[^/]+/, "") // Remove scheme and host
      : new URL(request.url).pathname.replace(
          new RegExp(`^(\/|)${bucket}`),
          "",
        );
    path = "/" + path.replace(/^\/+/, "");

    let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
    if (!objectSystem) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        `Bucket "${bucket}" not found`,
      );
    }

    /**
     * Head Bucket: HEAD /bucket
     */
    if (path === "/") {
      const isExists = await this._bucketSystem.isBucketExist(
        bucket,
        this._owner,
        true,
      );
      if (typeof isExists === "boolean") {
        if (isExists) {
          responseInit.status = 200;
        } else {
          responseInit.status = 404;
        }
        return new Response(null, responseInit);
      } else {
        responseInit.status = isExists.httpStatus || 404;
        return new Response(null, responseInit);
      }
    }

    /**
     * Head Object: HEAD /bucket/key
     */
    path = decodeURIComponent(path);
    path = "/" + path.replace(/^\/+/, "");
    const objectMetadata = await objectSystem.headObject(
      decodeURIComponent(path),
    );
    if (objectMetadata.errorCode) {
      return this.getErrorResponse(
        objectMetadata.httpStatus || 404,
        objectMetadata.error || "ObjectNotFound",
        `Object "${path}" not found in bucket "${bucket}"`,
      );
    }

    responseInit.headers["content-length"] =
      objectMetadata.contentLength?.toString() || "0";
    responseInit.headers["last-modified"] = objectMetadata.lastModified
      ? new Date(objectMetadata.lastModified).toUTCString()
      : new Date().toUTCString();
    if (objectMetadata.eTag) {
      responseInit.headers["etag"] = `"${objectMetadata.eTag}"`;
    }
    if (objectMetadata.contentType)
      responseInit.headers["content-type"] =
        objectMetadata.contentType || "application/octet-stream";
    return this.getResponse(responseInit, undefined);
  }

  async handlePut(
    request: Request,
    responseInit: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
    query: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Response> {
    const bucket = responseInit.internal?.bucket;
    if (!bucket) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        "Bad Request: Bucket name could not be determined",
      );
    }

    let path = responseInit.internal?.isVirtualHostedStyle
      ? request.url.replace(/^https?:\/\/[^/]+/, "") // Remove scheme and host
      : new URL(request.url).pathname.replace(
          new RegExp(`^(\/|)${bucket}`),
          "",
        );
    path = "/" + path.replace(/^\/+/, "");

    /**
     * Create Bucket: PUT /bucket
     */
    if (path.split("/").filter(Boolean).length === 0) {
      // Handle bucket creation
      const newBucketError = await this._bucketSystem.createBucketHandler({
        bucketName: bucket || `bucket-${crypto.randomUUID()}`,
        request,
      });

      if (newBucketError) {
        responseInit.status = newBucketError.httpStatus || 500;
        return this.getErrorResponse(
          newBucketError.httpStatus || 500,
          newBucketError.code || "InternalServerError",
          newBucketError.message ||
            "An error occurred while creating the bucket",
        );
      }

      responseInit.headers["content-length"] = "0";
      responseInit.headers.connection = "close";
      responseInit.headers.location = `${responseInit.internal?.isVirtualHostedStyle ? "/" : `/${bucket}`}`;
      return this.getResponse(responseInit, undefined);
    }

    let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
    if (!objectSystem) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        `Bucket "${bucket}" not found`,
      );
    }

    path = decodeURIComponent(path);
    path = "/" + path.replace(/^\/+/, "");

    const {
      "x-amz-copy-source": copySource,
      "x-amz-metadata-directive": metadataDirective,
      "x-amz-copy-source-range": copySourceRange,
    } = headers;
    const { partNumber, uploadId } = query;

    /**
     * Copy Object: PUT /bucket/key with x-amz-copy-source header
     */
    if (copySource) {
      const [sourceBucket, ...sourceKeyParts] = copySource
        .split("/")
        .filter(Boolean);
      const sourceObjectSystem =
        await this._bucketSystem.getObjectSystem(sourceBucket);
      if (!sourceObjectSystem) {
        responseInit.status = 404;
        return this.getErrorResponse(
          404,
          "BucketNotFound",
          `Source bucket "${sourceBucket}" not found`,
        );
      }
      const copyItem = await sourceObjectSystem.getObjectHandler(
        sourceKeyParts.join("/"),
      );
      if (copyItem.errorCode) {
        responseInit.status = copyItem.httpStatus || 404;
        return this.getErrorResponse(
          copyItem.httpStatus || 404,
          copyItem.error || "ObjectNotFound",
          `Source object "${sourceKeyParts.join("/")}" not found in bucket "${sourceBucket}"`,
        );
      }

      if (!bucket) {
        responseInit.status = 404;
        return this.getErrorResponse(
          404,
          "BucketNotFound",
          "Destination bucket could not be determined",
        );
      }

      const copyResult = await this._bucketSystem.copyObjectHandler({
        bucketName: bucket,
        key: path,
        copySource: copySource,
        copySourceRange,
        uploadId,
        partNumber: partNumber ? Number(partNumber) : undefined,
        request: request,
      });
      if (copyResult instanceof S3Error) {
        responseInit.status = copyResult.httpStatus || 500;
        return this.getErrorResponse(
          copyResult.httpStatus || 500,
          copyResult.code || "InternalServerError",
          copyResult.message || "An error occurred while copying the object",
        );
      }
      responseInit.headers["content-length"] = "0";
      responseInit.headers.connection = "close";
      responseInit.headers["ETag"] = `"${copyResult}"`;
      return this.getResponse(responseInit, copyResult);
    }

    const body = await request.arrayBuffer();

    /**
     * Multipart Upload: PUT /bucket/key?partNumber=1&uploadId=abc123
     */
    if (partNumber && uploadId) {
      const partBuffer = Buffer.from(new Uint8Array(body));

      const partMD5 = await objectSystem.uploadPartHandler({
        key: path,
        partNumber: Number(partNumber),
        uploadId,
        data: partBuffer,
      });
      responseInit.headers["ETag"] = `"${partMD5}"`;
      return this.getResponse(responseInit, partMD5);
    }

    /**
     * Put Object: PUT /bucket/key with body
     */
    const bodyBuf = body ? Buffer.from(body) : undefined;
    const md5Checksum = await objectSystem.putObjectHandler({
      key: path,
      data: bodyBuf,
    });

    responseInit.headers["content-length"] = "0";
    responseInit.headers.connection = "close";
    responseInit.headers["ETag"] = `"${md5Checksum}"`;
    return this.getResponse(responseInit, undefined);
  }

  async handlePost(
    request: Request,
    responseInit: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
    query: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Response> {
    const bucket = responseInit.internal?.bucket;
    if (!bucket) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        "Bad Request: Bucket name could not be determined",
      );
    }

    let path = responseInit.internal?.isVirtualHostedStyle
      ? request.url.replace(/^https?:\/\/[^/]+/, "") // Remove scheme and host
      : new URL(request.url).pathname.replace(
          new RegExp(`^(\/|)${bucket}`),
          "",
        );
    path = "/" + path.replace(/^\/+/, "");

    let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
    if (!objectSystem) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        `Bucket "${bucket}" not found`,
      );
    }

    path = decodeURIComponent(path);
    path = "/" + path.replace(/^\/+/, "");

    const { delete: deleteAction, uploads: uploadsAction, uploadId } = query;
    const contentType =
      headers["Content-Type"] ||
      headers["content-type"] ||
      "application/octet-stream";

    /**
     * Delete Multiple Objects: POST /bucket?delete with XML body specifying keys to delete
     */
    if (deleteAction === "") {
      // Handle delete multiple objects
      const rawDeleteXml = await request.text();
      const deleteRegex = /<Key>([^<]+)<\/Key>/g;
      const deleteMatches = [...rawDeleteXml.matchAll(deleteRegex)];
      const keysToDelete = deleteMatches.map((match) =>
        decodeURIComponent(match[1]),
      );
      // 3. Perform your deletion logic
      await objectSystem.deleteObjects(keysToDelete).catch((err) => {
        console.error(`Error deleting objects`, keysToDelete, err);
        const errorResponse = new S3Error(
          "DeleteError",
          "Error deleting objects",
        );
        responseInit.status = errorResponse.httpStatus || 500;
        return errorResponse.toXML();
      });

      return this.getResponse(
        responseInit,
        `<?xml version="1.0" encoding="UTF-8"?>
       <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         ${keysToDelete.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join("")}
       </DeleteResult>`,
      );
    }

    /**
     * Multipart Upload (Initiate/Complete): POST /bucket/key?uploads to initiate, then PUT /bucket/key?partNumber=1&uploadId=abc123 for each part, and finally POST /bucket/key?uploadId=abc123 with XML body specifying parts to complete
     */
    if (uploadsAction === "") {
      const createMultipartXml =
        await objectSystem.createMultipartUploadHandler({
          key: path,
          contentType,
        });
      return this.getResponse(responseInit, createMultipartXml as string);
    }

    /**
     * Complete Multipart Upload: POST /bucket/key?uploadId=abc123 with XML body specifying parts to complete
     */
    if (uploadId) {
      const rawCompleteMultipartUploadXml = await request.text();
      const partRegex =
        /<Part><PartNumber>(\d+)<\/PartNumber><ETag>"?([^"<]+)"?<\/ETag><\/Part>/g;
      const partMatches = [
        ...rawCompleteMultipartUploadXml.matchAll(partRegex),
      ];
      const parts = partMatches.map((match) => ({
        partNumber: Number(match[1]),
        eTag: match[2],
      }));
      const combinedData = await objectSystem.completeMultipartUploadHandler({
        url: request.url,
        key: path,
        uploadId,
        parts,
      });
      return this.getResponse(responseInit, combinedData as string);
    }

    return new Response("Not Implemented", { status: 501 });
  }

  async handleDelete(
    request: Request,
    responseInit: Internal<
      ResponseInit & { headers: Record<string, string | number> }
    >,
    query: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Response> {
    const bucket = responseInit.internal?.bucket;
    if (!bucket) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        "Bad Request: Bucket name could not be determined",
      );
    }

    let path = responseInit.internal?.isVirtualHostedStyle
      ? request.url.replace(/^https?:\/\/[^/]+/, "") // Remove scheme and host
      : new URL(request.url).pathname.replace(
          new RegExp(`^(\/|)${bucket}`),
          "",
        );
    path = "/" + path.replace(/^\/+/, "");

    /**
     * Delete Bucket: DELETE /bucket
     */
    if (path === "/") {
      // Handle bucket deletion
      const deleteBucketError = await this._bucketSystem.deleteBucketHandler({
        bucketName: bucket || `bucket-${crypto.randomUUID()}`,
        request,
      });

      if (deleteBucketError) {
        responseInit.status = deleteBucketError.httpStatus || 500;
        return this.getResponse(responseInit, deleteBucketError.toXML());
      }

      responseInit.status = 204;
      return this.getResponse(responseInit, undefined);
    }

    let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
    if (!objectSystem) {
      return this.getErrorResponse(
        404,
        "BucketNotFound",
        `Bucket "${bucket}" not found`,
      );
    }

    const { uploadId } = query;
    /**
     * Abort Multipart Upload: DELETE /bucket/key?uploadId=abc123
     */
    if (uploadId) {
      await objectSystem.abortMultipartUpload({
        key: `/${path}`,
        uploadId,
      });

      responseInit.status = 204;
      responseInit.headers.connection = "keep-alive";
      responseInit.headers["content-length"] = 0;
      return this.getResponse(responseInit, undefined);
    }

    /**
     * Delete Object: DELETE /bucket/key
     */
    path = decodeURIComponent(path);
    await objectSystem.deleteObjectHandler({
      key: path,
    });

    responseInit.status = 204;
    return this.getResponse(responseInit, undefined);
  }
}

import ElysiaS3ServerClass from "./ElysiaS3Server";

export const ElysiaS3Server = ElysiaS3ServerClass;
