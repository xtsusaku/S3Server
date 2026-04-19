import { Elysia, t } from "elysia";
import DefaultBucketSystem from "./api/default/DefaultBucketSystem";
import { S3Verifier } from "./api/S3Verifier";
import DefaultMetadataProvider from "./api/default/DefaultMetadataProvider";
import DefaultObjectSystem from "./api/default/DefaultObjectSystem";
import { existsSync } from "node:fs";
import { S3Error } from "./api/S3Error";
import { Readable } from "node:stream";

export type S3ServerOptions = S3Server.S3ServerOptions;

export default function S3Server({
  baseHost = [],
  iframeAllow = [],
  elysiaOptions = {},
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
  const app = new Elysia({
    ...elysiaOptions,
    name: "S3Server",
  })
    .state("owner", owner as S3Server.Owner)
    .state("requestId", "")
    .state("bucket", null as string | null)
    .state("isRootRequest", false)
    .state("isVirtualHostedStyle", false);

  /**
   * Authentication Middleware
   */
  app.onBeforeHandle(({ request, headers, query, body, store, set }) => {
    store.requestId = crypto.randomUUID();
    set.headers["x-amz-request-id"] = store.requestId;
    set.headers["content-security-policy"] =
      `frame-ancestors 'self' ${iframeAllow.join(" ")}`;
    if (
      !S3Verifier.mutateRequestAsync(
        request,
        body as Buffer,
        bucketSystem.getSecretKey(request),
      )
      // !S3Verifier.verify(
      //   request.method,
      //   new URL(request.url),
      //   headers as Record<string, string>,
      //   query as Record<string, string>,
      //   body as Buffer,
      //   bucketSystem.getSecretKey(request),
      // )
    ) {
      console.log(
        `Authentication failed for request ${store.requestId}: ${request.method} ${request.url}`,
      );
      set.status = 403;
      set.headers["content-type"] = "application/xml";
      return bucketSystem.getAccessDeniedResponse(store.requestId);
    }
    if (
      !S3Verifier.verifyTime(
        headers as Record<string, string>,
        query as Record<string, string>,
      )
    ) {
      console.log(
        `Request ${store.requestId} is too old or too far in the future. Rejecting request.`,
      );
      set.status = 403;
      set.headers["content-type"] = "application/xml";
      return bucketSystem.getAccessDeniedResponse(store.requestId);
    }
    // if (headers && headers["x-amz-date"]) {
    //   const UTCRequestDate = bucketSystem.getDate(headers["x-amz-date"]);
    //   const now = new Date();
    //   const timeDiff = Math.abs(now.getTime() - UTCRequestDate.getTime());
    //   // console.info(
    //   //   `Request time: ${UTCRequestDate.toISOString()}, Current time: ${now.toISOString()}, Time difference: ${timeDiff} ms`,
    //   // );
    //   if (timeDiff > 15 * 60 * 1000) {
    //     // Request is older than 15 minutes
    //   }
    // }
  });

  /**
   * Extract bucket name middleware
   */
  app.onBeforeHandle(async ({ request, store }) => {
    const url = new URL(request.url);
    let host = request.headers.get("host") || "";
    for (const base of baseHost) {
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

    store.owner = await bucketSystem.getOwner(request);
    store.bucket = bucket;
    store.isRootRequest = bucket = url.pathname === "/";
    store.isVirtualHostedStyle = !!vhostMatch;
  });

  // app.onBeforeHandle(async (ctx) => {
  //   // if (ctx.request.method === "GET") return;
  //   // Log the request headers and body for debugging purposes
  //   console.log("");
  //   console.log("================================");
  //   console.log("==== New Request Received ======");
  //   console.log(`Method: ${ctx.request.method}`);
  //   console.log(`URL: ${ctx.request.url}`);
  //   console.log(`Path: ${ctx.path}`);
  //   console.log(`Query: ${JSON.stringify(ctx.query)}`);
  //   console.log(`Headers: ${JSON.stringify(ctx.headers)}`);
  //   console.log(`Body: ${await ctx.request.arrayBuffer()}`);
  //   console.log("");
  // });

  /**
   * Operations in this request:
   * - List Buckets: GET /
   */
  app.get(
    "/",
    async ({ request, set, query, store: { bucket, isRootRequest } }) => {
      if (isRootRequest) {
        // Handle list buckets
        const bucketXml = await bucketSystem.listsBucketsHandler({
          request,
          prefix: query.prefix as string | undefined,
          maxBuckets: query["max-keys"]
            ? parseInt(query["max-keys"].toString())
            : undefined,
          continuationToken: query["continuation-token"] as string | undefined,
        });
        set.headers["content-type"] = "application/xml";
        if (bucketXml) return bucketXml;
        set.status = 401;
        return new Error("Error listing buckets");
      }
    },
  );

  /**
   * Operations in this request:
   * - List Objects V2: GET /:bucket?list-type=2
   * - Get Object: GET /:bucket/*
   */
  app.get(
    "/*",
    async ({
      request,
      set,
      params: { "*": path },
      headers: { range },
      query: {
        "list-type": listType,
        prefix,
        delimiter,
        "fetch-owner": fetchOwner,
        "max-keys": maxKeys,
        "continuation-token": continuationToken,
        "start-after": startAfter,
        "encoding-type": encodingType,
        "expected-bucket-owner": expectedBucketOwner,
      },
      store: { bucket, isRootRequest, isVirtualHostedStyle, owner },
    }) => {
      path = isVirtualHostedStyle
        ? path
        : path.replace(new RegExp(`^(\/|)${bucket}`), "");
      path = "/" + path.replace(/^\/+/, "");
      let objectSystem = await bucketSystem.getObjectSystem(bucket);

      if (!objectSystem || !bucket) {
        set.status = 404;
        return new Error("Bucket not found");
      }

      if (path === "/") {
        // Handle list objects v2
        if (objectSystem) {
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
          set.headers["content-type"] = "application/xml";
          return listObjectsXml;
        }
      }

      path = decodeURIComponent(path);
      path = "/" + path.replace(/^\/+/, "");
      const objectMetadata = await objectSystem.getObject(
        decodeURIComponent(path),
        range,
      );
      if (objectMetadata.errorCode) {
        set.status = objectMetadata.httpStatus || 404;
        return new Error(objectMetadata.error || "Object not found");
      }

      set.headers["content-length"] =
        objectMetadata.contentLength?.toString() || "0";
      set.headers["last-modified"] = objectMetadata.lastModified
        ? new Date(objectMetadata.lastModified).toUTCString()
        : new Date().toUTCString();
      if (objectMetadata.eTag) {
        set.headers["etag"] = `"${objectMetadata.eTag}"`;
      }
      // set.headers["content-type"] = "application/octet-stream";
      if (range) set.headers["accept-ranges"] = "bytes";
      if (objectMetadata.contentType)
        set.headers["content-type"] = objectMetadata.contentType;
      if (objectMetadata.data) return Readable.from(objectMetadata.data);
      else return undefined;
    },
  );

  /**
   * Operations in this request:
   * - Head Buckets: HEAD /:bucket
   * - Head Object: HEAD /:bucket/*
   */
  app.head(
    "/*",
    async ({
      request,
      set,
      params: { "*": path },
      store: { bucket, isRootRequest, isVirtualHostedStyle, owner },
    }) => {
      path = isVirtualHostedStyle
        ? path
        : path.replace(new RegExp(`^${bucket}`), "");

      if (path === "/") {
        // Handle bucket head request (check if bucket exists)
        if (bucket) {
          const isExists = await bucketSystem.isBucketExist(
            bucket,
            owner,
            true,
          );
          if (typeof isExists === "boolean") {
            if (isExists) {
              set.status = 200;
            } else {
              set.status = 404;
            }
            return;
          } else {
            set.status = isExists.httpStatus || 404;
            return;
          }
        }

        set.headers["content-length"] = "0";
        set.headers.connection = "close";
        set.headers.location = `${isVirtualHostedStyle ? "/" : `/${bucket}`}`;
        return;
      }

      const objectSystem = await bucketSystem.getObjectSystem(bucket);
      if (!objectSystem) {
        set.status = 404;
        return new Error("Bucket not found");
      }

      const objectMetadata = await objectSystem.headObjectHandler(
        decodeURIComponent(path),
      );
      if (objectMetadata.errorCode) {
        set.status = objectMetadata.httpStatus || 404;
        return new Error(objectMetadata.error || "Object not found");
      }

      set.headers["content-length"] =
        objectMetadata.contentLength?.toString() || "0";
      set.headers["last-modified"] = objectMetadata.lastModified
        ? new Date(objectMetadata.lastModified).toUTCString()
        : new Date().toUTCString();
      if (objectMetadata.eTag) {
        set.headers["etag"] = `"${objectMetadata.eTag}"`;
      }
      set.headers["content-type"] =
        objectMetadata.contentType || "application/octet-stream";
      return;
    },
  );

  /**
   * Operations in this request:
   * - Create Buckets: PUT /:bucket
   * - Put Object: PUT /:bucket/*
   * - Upload Part: PUT /:bucket/*?partNumber=xxx&uploadId=xxx
   * - Copy Object: PUT /:bucket/* with header x-amz-copy-source
   */
  app.put(
    "/*",
    async ({
      request,
      set,
      body,
      headers: {
        "x-amz-copy-source": copySource,
        "x-amz-metadata-directive": metadataDirective,
        "x-amz-copy-source-range": copySourceRange,
      },
      query: { partNumber, uploadId },
      params: { "*": path },
      store: { bucket, isRootRequest, isVirtualHostedStyle },
    }) => {
      path = isVirtualHostedStyle
        ? path
        : path.replace(new RegExp(`^${bucket}`), "");

      if (path.split("/").filter(Boolean).length === 0) {
        // Handle bucket creation
        const newBucketError = await bucketSystem.createBucketHandler({
          bucketName: bucket || `bucket-${crypto.randomUUID()}`,
          request,
        });

        if (newBucketError) {
          set.status = newBucketError.httpStatus || 500;
          return newBucketError.toXML();
        }

        set.headers["content-length"] = "0";
        set.headers.connection = "close";
        set.headers.location = `${isVirtualHostedStyle ? "/" : `/${bucket}`}`;
        return;
      }

      const objectSystem = await bucketSystem.getObjectSystem(bucket);
      if (!objectSystem) {
        set.status = 404;
        return new Error("Bucket not found");
      }

      path = decodeURIComponent(path);
      path = "/" + path.replace(/^\/+/, "");

      if (copySource) {
        const [sourceBucket, ...sourceKeyParts] = copySource
          .split("/")
          .filter(Boolean);
        const sourceObjectSystem =
          await bucketSystem.getObjectSystem(sourceBucket);
        if (!sourceObjectSystem) {
          set.status = 404;
          return new Error("Source Bucket not found");
        }
        const copyItem = await sourceObjectSystem.getObjectHandler(
          sourceKeyParts.join("/"),
        );
        if (copyItem.errorCode) {
          set.status = copyItem.httpStatus || 404;
          return new Error(copyItem.error || "Source Object not found");
        }

        if (!bucket) {
          set.status = 404;
          return new Error("Destination Bucket not found");
        }

        const copyResult = await bucketSystem.copyObjectHandler({
          bucketName: bucket,
          key: path,
          copySource: copySource,
          copySourceRange,
          uploadId,
          partNumber: partNumber ? Number(partNumber) : undefined,
          request: request,
        });
        if (copyResult instanceof S3Error) {
          set.status = copyResult.httpStatus || 500;
          return copyResult.toXML();
        }
        set.headers["content-length"] = "0";
        set.headers.connection = "close";
        set.headers["ETag"] = `"${copyResult}"`;
        return copyResult;
      }

      if (partNumber && uploadId) {
        const partBuffer = Buffer.from(new Uint8Array(body as ArrayBuffer));

        const partMD5 = await objectSystem.uploadPartHandler({
          key: path,
          partNumber: Number(partNumber),
          uploadId,
          data: partBuffer,
        });
        set.headers["ETag"] = `"${partMD5}"`;
        return partMD5;
      }

      const bodyBuf = body
        ? body instanceof Buffer
          ? body
          : Buffer.from(body as string)
        : undefined;
      const md5Checksum = await objectSystem.putObjectHandler({
        key: path,
        data: bodyBuf,
      });

      set.headers["content-length"] = "0";
      set.headers.connection = "close";
      set.headers["ETag"] = `"${md5Checksum}"`;
      return;
    },
    {
      parse: "application/octet-stream",
    },
  );

  /**
   * Operations in this request:
   * - Create Multipart Upload: POST /:bucket/*?uploads
   * - Complete Multipart Upload: POST /:bucket/*?uploadId=xxx
   * - Delete Multiple Objects: POST /:bucket/*?delete
   */
  app.post(
    "/*",
    async ({
      request,
      set,
      body,
      headers,
      headers: { "content-type": contentType },
      query: { uploads, uploadId, delete: deleteQuery },
      params: { "*": path },
      store: { bucket, isRootRequest, isVirtualHostedStyle },
    }) => {
      path = isVirtualHostedStyle
        ? path
        : path.replace(new RegExp(`^${bucket}`), "");

      const objectSystem = await bucketSystem.getObjectSystem(bucket);
      if (!objectSystem) {
        set.status = 404;
        return new Error("Bucket not found");
      }

      path = decodeURIComponent(path);
      path = "/" + path.replace(/^\/+/, "");

      if (deleteQuery === "") {
        const rawDeleteXml = await request.text();
        const deleteRegex = /<Key>([^<]+)<\/Key>/g;
        const deleteMatches = [...rawDeleteXml.matchAll(deleteRegex)];
        const keysToDelete = deleteMatches.map((match) =>
          decodeURIComponent(match[1]),
        );
        // 3. Perform your deletion logic
        await objectSystem.deleteObjects(keysToDelete).catch((err: any) => {
          console.error(`Error deleting objects`, keysToDelete, err);
          const errorResponse = new S3Error(
            "DeleteError",
            "Error deleting objects",
          );
          set.status = errorResponse.httpStatus || 500;
          return errorResponse.toXML();
        });

        // 4. Return the required S3 Success Response
        // Even if Quiet is true, S3 expects a DeleteResult XML
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
       <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         ${keysToDelete.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join("")}
       </DeleteResult>`,
          { headers: { "Content-Type": "application/xml" } },
        );
      }

      if (uploads === "") {
        const createMultipartXml =
          await objectSystem.createMultipartUploadHandler({
            key: path,
            contentType,
          });
        return createMultipartXml;
      }

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
        return combinedData;
      }
    },
  );

  /**
   * Operations in this request:
   * - Delete Buckets: DELETE /:bucket
   * - Delete Object: DELETE /:bucket/*
   * - Abort Multipart Upload: DELETE /:bucket/*?uploadId=xxx
   */
  app.delete(
    "/*",
    async ({
      request,
      set,
      params: { "*": path },
      query: { uploadId },
      store: { bucket, isRootRequest, isVirtualHostedStyle },
    }) => {
      path = isVirtualHostedStyle
        ? path
        : path.replace(new RegExp(`^${bucket}`), "");

      if (path === "/") {
        // Handle bucket deletion
        const deleteBucketError = await bucketSystem.deleteBucketHandler({
          bucketName: bucket || `bucket-${crypto.randomUUID()}`,
          request,
        });

        if (deleteBucketError) {
          set.status = deleteBucketError.httpStatus || 500;
          return deleteBucketError.toXML();
        }

        set.status = 204;
      }

      const objectSystem = await bucketSystem.getObjectSystem(bucket);
      if (!objectSystem) {
        set.status = 404;
        return new Error("Bucket not found");
      }

      if (uploadId) {
        await objectSystem.abortMultipartUpload({
          key: `/${path}`,
          uploadId,
        });

        set.status = 204;
        set.headers.connection = "keep-alive";
        set.headers["content-length"] = 0;
        return;
      }

      path = decodeURIComponent(path);
      const deleteResult = await objectSystem.deleteObjectHandler({
        key: path,
      });

      set.status = 204;
      return;
    },
  );

  return app;
}
