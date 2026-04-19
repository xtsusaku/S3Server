declare namespace S3Server {
  type S3ServerOptions = {
    baseHost?: string[];
    iframeAllow?: string[];
    elysiaOptions?: ConstructorParameters<typeof import("elysia").Elysia>[0];
    metadataProviderClass?: typeof import("./s3/api/abs/MetadataProvider").default;
    metadataProviderOptions?: ConstructorParameters<
      typeof import("./s3/api/abs/MetadataProvider").default
    >[0];
    objectSystemClass?: typeof import("./s3/api/abs/ObjectSystem").default;
    objectSystemOptions?: ConstructorParameters<
      typeof import("./s3/api/abs/ObjectSystem").default
    >[0];
    bucketSystem?: import("../src/s3/api/abs/BucketSystem").default;
    owner?: S3Server.Owner;
    region?: string;
  };

  type WithError<T> = {
    errorCode?: number;
    error?: string;
    data?: T;
  };

  type Owner = {
    id: string;
    displayName: string;
  };

  type StorageClass =
    | "STANDARD"
    | "STANDARD_IA"
    | "ONEZONE_IA"
    | "INTELLIGENT_TIERING"
    | "GLACIER_IR"
    | "GLACIER"
    | "DEEP_ARCHIVE";

  namespace Bucket {
    type Bucket = {
      name: string;
      creationDate?: Date;
      region?: string;
    };
    type ListBucketsOptions = {
      request: Request;
      owner?: Owner;
      prefix?: string;
      maxBuckets?: number;
      continuationToken?: string;
    };
    type ListBucketsReturn = {
      buckets: S3Server.Bucket.Bucket[];
      owner?: S3Server.Owner;
      nextContinuationToken?: string;
    };

    type CreateDeleteBucketOptions = {
      request: Request;
      bucketName: string;
    };
  }

  namespace Object {
    type Object = {
      key: string;
      contentType?: string;
      lastModified?: Date;
      size?: number;
      md5Checksum?: string;
      storageClass?: StorageClass;
      [key: string]: any;
    };
    type Folder = {
      key: string;
      lastModified?: Date;
      size?: number;
      md5Checksum?: string;
      folderKeys?: string[];
      fileKeys?: string[];
    };

    type ListObjectsV2HandlerOptions = {
      listType?: "2" | string;
      prefix?: string;
      delimiter?: string;
      fetchOwner?: boolean;
      maxKeys?: number;
      continuationToken?: string;
      startAfter?: string;
      encodingType?: string;
      expectedBucketOwner?: string;
    };
    type ListObjectsV2Return = {
      folders: Folder[];
      files: Object[];
      nextContinuationToken?: string;
    };
    type PutObjectHandlerOptions = {
      key: string;
      contentType?: string;
      data:
        | Buffer
        | import("node:stream/web").ReadableStream
        | import("node:stream").Readable
        | string
        | undefined;
      checksumAlgorithm?: ChecksumAlgorithm;
      checksumType?: ChecksumType;
    };

    type GetHeadObjectReturn = {
      data?:
        | Buffer
        | import("node:stream/web").ReadableStream
        | import("node:stream").Readable;
      eTag?: string;
      lastModified?: Date;
      contentType?: string;
      contentLength?: number;
      contentRange?: string;
      contentEncoding?: string;
      expires?: Date;
      [key: string]: any;
    };
    type GetHeadObjectHandlerOptions = {
      key: string;
      partNumber?: number;
      versionId?: string;
      range?: string;
    };
    type DeleteObjectHandlerOptions = {
      key: string;
      versionId?: string;
    };

    type CreateMultipartUploadHandlerOptions = {
      key: string;
      contentType?: string;
    };

    type MultipartPutObjectHandlerOptions = {
      key: string;
      partNumber: number;
      uploadId: string;
      data:
        | Buffer
        | import("node:stream/web").ReadableStream
        | import("node:stream").Readable;
      checksumAlgorithm?: ChecksumAlgorithm;
      checksumType?: ChecksumType;
    };

    type CompleteMultipartUploadHandlerOptions = {
      url: string;
      key: string;
      uploadId: string;
      parts: {
        partNumber: number;
        eTag: string;
      }[];
    };

    type AbortMultipartUploadHandlerOptions = {
      key: string;
      uploadId: string;
    };

    type CopyObjectHandlerOptions = {
      bucketName: string;
      key: string;
      copySource: string;
      copySourceRange?: string;
      uploadId?: string;
      partNumber?: number;
      request: Request;
    };
  }

  namespace Metadata {
    type GetFileMetadataOptions = {
      key: string;
    };
    type AddFileMetadataOptions = {
      key: string;
      lastModified?: Date;
      size?: number;
      md5Checksum?: string;
      [key: string]: any;
    };
    type RemoveFileMetadataOptions = {
      key: string;
      versionId?: string;
    };
    type GetFolderMetadataOptions = {
      key: string;
      limit?: number;
      offset?: number;
    };
    type AddFolderMetadataOptions = {
      key: string;
      lastModified?: Date;
      size?: number;
      md5Checksum?: string;
      [key: string]: any;
    };
    type RemoveFolderMetadataOptions = {
      key: string;
    };
  }
}
