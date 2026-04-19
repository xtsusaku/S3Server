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
import DefaultMetadataProvider from "../default/DefaultMetadataProvider.js";
import DefaultObjectSystem from "../default/DefaultObjectSystem.js";
import { S3Error } from "../S3Error.js";
import { validateBucketName } from "../validators/bucket-name.js";
import MetadataProvider from "./MetadataProvider.js";
import ObjectSystem from "./ObjectSystem.js";

export default abstract class BucketSystem {
  protected buckets: Map<string, ObjectSystem> = new Map();
  protected _metadataProvider: MetadataProvider;

  constructor(
    protected _secretKey: string,
    protected _region: string,
    protected _metadataProviderClass = DefaultMetadataProvider,
    protected _metadataProviderOptions: ConstructorParameters<
      typeof _metadataProviderClass
    >[1] = {},
    protected _objectSystemClass = DefaultObjectSystem,
    protected _objectSystemOptions: ConstructorParameters<
      typeof _objectSystemClass
    >[2] = {},
  ) {
    this._metadataProvider = new this._metadataProviderClass(
      undefined,
      this._metadataProviderOptions,
    );
  }

  getDate(data: Date | string | number): Date {
    return this._metadataProvider.getDate(data);
  }

  normalizeDate(data: Date | string | number): string {
    return this._metadataProvider.normalizeDate(data);
  }

  getSecretKey(request?: Request): string {
    return this._secretKey;
  }

  getAccessDeniedResponse(requestId: string) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
  <RequestId>${requestId || crypto.randomUUID()}</RequestId>
</Error>`;
  }

  abstract getOwner(request?: Request): Promise<S3Server.Owner>;

  async isBucketExist(
    bucketName: string,
    owner?: S3Server.Owner,
    reqOwner = false,
  ): Promise<S3Error | boolean> {
    if (reqOwner && !owner) {
      return new S3Error("AccessDenied", "Access Denied", 403, {
        bucketName,
      });
    }
    return this._metadataProvider.isBucketExist(bucketName, owner);
  }

  async listsBucketsHandler(options: S3Server.Bucket.ListBucketsOptions) {
    let owner = {
      id: options.request.headers.get("x-amz-user-id") || "unknown",
      displayName: options.request.headers.get("x-amz-user-name") || "unknown",
    };
    if (owner.id === "unknown" || owner.displayName === "unknown") {
      const extractedOwner = await this.getOwner(options.request);
      owner = {
        id: extractedOwner.id || owner.id,
        displayName: extractedOwner.displayName || owner.displayName,
      };
    }

    const buckets = await this._metadataProvider.listBuckets({
      request: options.request,
      owner: owner,
      maxBuckets: options.maxBuckets || 100,
      prefix: options.prefix,
      continuationToken: options.continuationToken,
    });

    if (buckets.data && !buckets.errorCode) {
      const buctetsXml = buckets.data.buckets
        .map(
          (bucket) => `
      <Bucket>
        <Name>${bucket.name}</Name>
        ${bucket.creationDate ? `<CreationDate>${this._metadataProvider.normalizeDate(bucket.creationDate)}</CreationDate>` : ""}
        ${bucket.region ? `<Region>${bucket.region}</Region>` : ""}
      </Bucket>`,
        )
        .join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    ${buctetsXml}
  </Buckets>
  <Owner>
    <ID>${owner.id}</ID>
    <DisplayName>${owner.displayName}</DisplayName>
  </Owner>
  ${buckets.data.nextContinuationToken ? `<ContinuationToken>${buckets.data.nextContinuationToken}</ContinuationToken>` : ""}
  ${options.prefix ? `<Prefix>${options.prefix}</Prefix>` : ""}
</ListAllMyBucketsResult>`;
      return xml;
    } else
      return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets></Buckets>
  <Owner>
    <ID>${owner.id}</ID>
    <DisplayName>${owner.displayName}</DisplayName>
  </Owner>
  ${buckets.data?.nextContinuationToken ? `<ContinuationToken>${buckets.data.nextContinuationToken}</ContinuationToken>` : ""}
  ${options.prefix ? `<Prefix>${options.prefix}</Prefix>` : ""}
</ListAllMyBucketsResult>`;
  }

  async createBucketHandler(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ) {
    const { request, bucketName } = options;
    if (validateBucketName(bucketName) !== null) {
      return new S3Error(
        "InvalidBucketName",
        "The specified bucket is not valid.",
        400,
        { bucketName },
      );
    }
    // Check if bucket already exists
    const existingBucket =
      await this._metadataProvider.isBucketExist(bucketName);
    if (existingBucket === true) {
      return new S3Error(
        "BucketAlreadyExists",
        "The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.",
        409,
        { bucketName },
      );
    }

    // Create bucket metadata
    // In a real implementation, you would also want to persist this metadata to a database or file system.
    const bucketData = await this._metadataProvider.createBucket(options);
    if (bucketData.errorCode) {
      return new S3Error(
        "InternalServerError",
        "An internal server error occurred.",
        bucketData.errorCode,
        { bucketName },
      );
    }
    // Initialize object system for the new bucket
    this.buckets.set(
      bucketName,
      new this._objectSystemClass(
        bucketName,
        this._metadataProvider.getBucketMetadata(bucketName),
        this._objectSystemOptions,
      ),
    );

    return;
  }

  async deleteBucketHandler(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ) {
    const { request, bucketName } = options;
    const existingBucket =
      await this._metadataProvider.isBucketExist(bucketName);
    if (!existingBucket) {
      return new S3Error(
        "NoSuchBucket",
        "The specified bucket does not exist.",
        404,
        { bucketName },
      );
    }

    // In a real implementation, you would also want to remove the metadata from your database or file system.
    const deleteData = await this._metadataProvider.deleteBucket(options);
    if (deleteData.errorCode) {
      return new S3Error(
        "InternalServerError",
        "An internal server error occurred.",
        deleteData.errorCode,
        { bucketName },
      );
    }
    this.buckets.delete(bucketName);
    return;
  }

  async getObjectSystem(
    bucketName: string | undefined | null,
  ): Promise<ObjectSystem | undefined> {
    if (!bucketName) return undefined;
    if (this.buckets.has(bucketName)) {
      return this.buckets.get(bucketName);
    }
    const bucketExist = await this.isBucketExist(bucketName);
    if (bucketExist === true) {
      const objectSystem = new this._objectSystemClass(
        bucketName,
        this._metadataProvider.getBucketMetadata(bucketName),
        this._objectSystemOptions,
      );
      this.buckets.set(bucketName, objectSystem);
      return objectSystem;
    }
    return undefined;
  }

  async copyObjectHandler(options: S3Server.Object.CopyObjectHandlerOptions) {
    const { bucketName, key, copySource, request } = options;
    const sourceMatch = copySource.match(/^\/?([^\/]+)\/(.+)$/);
    if (!sourceMatch) {
      return new S3Error(
        "InvalidArgument",
        "Copy source must be in the format /{bucket}/{key}",
        400,
        { copySource },
      );
    }
    const [_, sourceBucketName, sourceKey] = sourceMatch;
    const sourceObjectSystem = await this.getObjectSystem(sourceBucketName);
    if (!sourceObjectSystem) {
      return new S3Error(
        "NoSuchBucket",
        "The specified source bucket does not exist.",
        404,
        { bucketName: sourceBucketName },
      );
    }
    const targetObjectSystem = await this.getObjectSystem(bucketName);
    if (!targetObjectSystem) {
      return new S3Error(
        "NoSuchBucket",
        "The specified destination bucket does not exist.",
        404,
        { bucketName },
      );
    }
    const headData = await sourceObjectSystem.headObjectHandler(sourceKey);
    if (headData.errorCode) {
      return new S3Error(
        "NoSuchKey",
        "The specified source key does not exist.",
        headData.errorCode,
        { key: sourceKey },
      );
    }
    const getData = await sourceObjectSystem.getObjectHandler(
      sourceKey,
      options.copySourceRange,
    );
    if (getData.errorCode) {
      return new S3Error(
        "NoSuchKey",
        "The specified source key does not exist.",
        getData.errorCode,
        { key: sourceKey },
      );
    }
    if (!options.uploadId && getData.data) {
      // const bufferData = await targetObjectSystem.ensureBuffer(getData.data);
      const putData = await targetObjectSystem.putObjectHandler({
        key,
        data: getData.data,
      });

      if (putData)
        return `<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <ETag>"${putData}"</ETag>
  <LastModified>${this._metadataProvider.normalizeDate(
    new Date(),
  )}</LastModified>
</CopyObjectResult>`;
      else
        return new S3Error(
          "InternalServerError",
          "An internal server error occurred.",
          500,
          { key },
        );
    } else {
      const uploadPartData = await targetObjectSystem.uploadPartHandler({
        key,
        partNumber: options.partNumber!,
        uploadId: options.uploadId!,
        data: getData.data!,
      });
      if (uploadPartData)
        return `<?xml version="1.0" encoding="UTF-8"?>
<CopyPartResult>
  <ETag>"${uploadPartData}"</ETag>
  <LastModified>${this._metadataProvider.normalizeDate(
    new Date(),
  )}</LastModified>
</CopyPartResult>`;
      else
        return new S3Error(
          "InternalServerError",
          "An internal server error occurred.",
          500,
          { key },
        );
    }
  }
}
