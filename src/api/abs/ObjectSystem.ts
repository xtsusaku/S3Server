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
import MetadataProvider from "./MetadataProvider.js";
import { S3Error } from "../S3Error.js";
import { ReadableStream } from "node:stream/web";
import { Readable } from "node:stream";

export default abstract class ObjectSystem<T = Record<string, any>> {
  _multipartUploads: Map<
    string,
    {
      key: string;
      contentType: string;
      parts: [];
    }
  > = new Map();

  constructor(
    protected bucketName: string,
    protected metadataProvider: MetadataProvider,
    options?: T,
  ) {}

  async ensureBuffer(
    data: Buffer | ReadableStream | Readable | string,
  ): Promise<Buffer> {
    let BufferData: Buffer | undefined;
    if (data instanceof Buffer) {
      BufferData = data;
    } else if (data instanceof ReadableStream) {
      let buffers: Uint8Array[] = [];
      const reader = data.getReader();
      let done: boolean | undefined = false;
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        if (value) buffers.push(value);
        done = doneReading;
      }
      BufferData = Buffer.concat(buffers.map((b) => Buffer.from(b)));
    } else if (data instanceof Readable) {
      let buffers: Uint8Array[] = [];
      for await (const chunk of data) {
        buffers.push(chunk);
      }
      BufferData = Buffer.concat(buffers);
    } else if (typeof data === "string") {
      BufferData = Buffer.from(data);
    }
    if (!BufferData) {
      throw new Error(
        "Data must be a Buffer, ReadableStream, Readable, or string",
      );
    }
    return BufferData;
  }

  abstract listObjects(
    options: S3Server.Object.ListObjectsV2HandlerOptions,
  ): Promise<S3Server.Object.ListObjectsV2Return>;
  async listObjectsV2Handler(
    options: S3Server.Object.ListObjectsV2HandlerOptions = {},
  ) {
    options.listType = options.listType || "2";
    if (options.listType !== "2") {
      return new S3Error("ListObjectsV2Only", "Only list-type 2 is supported");
    }
    let {
      prefix,
      delimiter = "/",
      maxKeys = 1000,
      continuationToken,
      encodingType,
      startAfter,
      expectedBucketOwner,
    } = options;
    prefix =
      prefix && prefix !== "" && prefix !== "/"
        ? "/" + prefix.replace(/^\/+/g, "").replace(/\/+$/g, "") + "/"
        : "/";

    const { folders, files, nextContinuationToken } =
      await this.listObjects(options);
    const contentXml = files
      .map(
        (file) => `
      <Contents>
        <Key>${file.key}</Key>
        ${file.lastModified ? `<LastModified>${typeof file.lastModified === "string" ? file.lastModified : file.lastModified.toISOString()}</LastModified>` : ""}
        ${file.size !== undefined ? `<Size>${file.size}</Size>` : ""}
        ${file.md5Checksum ? `<ETag>"${file.md5Checksum}"</ETag>` : ""}
      </Contents>`,
      )
      .join("");
    const commonPrefixesXml = folders
      .map(
        (folder) => `
      <CommonPrefixes>
        <Prefix>${folder.key.replace(/^\/+/, "").replace(/\/+$/, "")}</Prefix>
      </CommonPrefixes>`,
      )
      .join("");

    let isTruncated = false;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
    <Name>${this.bucketName}</Name>
    ${prefix ? `<Prefix>${prefix}</Prefix>` : ""}
    <KeyCount>${files.length}</KeyCount>
    <MaxKeys>${maxKeys}</MaxKeys>
    <Delimiter>${delimiter}</Delimiter>
    <IsTruncated>${isTruncated}</IsTruncated>
    ${contentXml}
    ${commonPrefixesXml}
    ${continuationToken ? `<ContinuationToken>${continuationToken}</ContinuationToken>` : ""}
    ${nextContinuationToken ? `<NextContinuationToken>${nextContinuationToken}</NextContinuationToken>` : ""}
    ${encodingType ? `<EncodingType>${encodingType}</EncodingType>` : ""}
    ${startAfter ? `<StartAfter>${startAfter}</StartAfter>` : ""}
</ListBucketResult>`;
    return xml;
  }

  abstract putObject(
    options: S3Server.Object.PutObjectHandlerOptions,
  ): Promise<string | undefined>;
  async putObjectHandler(options: S3Server.Object.PutObjectHandlerOptions) {
    const { key, data, contentType, checksumAlgorithm, checksumType } = options;
    const md5Checksum = await this.putObject(options);
    return md5Checksum;
  }

  abstract headObject(
    key: string,
  ): Promise<S3Server.Object.GetHeadObjectReturn>;
  async headObjectHandler(
    key: string,
  ): Promise<S3Server.Object.GetHeadObjectReturn> {
    const data = await this.headObject(key);
    return data;
  }

  abstract getObject(
    key: string,
    range?: string,
  ): Promise<S3Server.Object.GetHeadObjectReturn>;
  async getObjectHandler(
    key: string,
    range?: string,
  ): Promise<S3Server.Object.GetHeadObjectReturn> {
    key = key.replace(/^\//g, "");
    const data = await this.getObject(key, range);
    return data;
  }

  abstract deleteObject(
    options: S3Server.Object.DeleteObjectHandlerOptions,
  ): Promise<void>;
  async deleteObjectHandler(
    options: S3Server.Object.DeleteObjectHandlerOptions,
  ): Promise<void> {
    await this.deleteObject(options);
  }

  async createMultipartUploadHandler(
    options: S3Server.Object.CreateMultipartUploadHandlerOptions,
  ) {
    let { key, contentType } = options;
    key = "/" + key.replace(/^\//g, "");
    const uploadId = crypto.randomUUID();
    this._multipartUploads.set(uploadId, {
      key,
      contentType: contentType || "application/octet-stream",
      parts: [],
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Bucket>${this.bucketName}</Bucket>
    <Key>${key}</Key>
    <UploadId>${uploadId}</UploadId>
</InitiateMultipartUploadResult>`;
  }
  abstract handleUploadPart(
    uploadId: string,
    partNumber: number,
    data: Buffer | ReadableStream | Readable,
  ): Promise<string>;
  async uploadPartHandler(
    options: S3Server.Object.MultipartPutObjectHandlerOptions,
  ) {
    let { key, partNumber, uploadId, data, checksumAlgorithm, checksumType } =
      options;
    key = "/" + key.replace(/^\/+/g, "");
    const upload = this._multipartUploads.get(uploadId);
    if (!upload) {
      throw new Error("Invalid upload ID");
    }
    if (upload.key !== key) {
      throw new Error("Key does not match upload ID");
    }
    const partMD5 = await this.handleUploadPart(uploadId, partNumber, data);
    return partMD5;
  }
  abstract getCompleteMultipartCombine(
    uploadId: string,
    parts: S3Server.Object.CompleteMultipartUploadHandlerOptions["parts"],
  ): Promise<Buffer | Readable | undefined>;
  async completeMultipartUploadHandler(
    options: S3Server.Object.CompleteMultipartUploadHandlerOptions,
  ) {
    const { key, uploadId, parts } = options;
    const upload = this._multipartUploads.get(uploadId);
    if (!upload) {
      throw new Error("Invalid upload ID");
    }
    if (upload.key !== key) {
      throw new Error("Key does not match upload ID");
    }
    const combinedData = await this.getCompleteMultipartCombine(
      uploadId,
      parts,
    );
    if (combinedData) {
      const file = await this.putObject({
        key,
        contentType: upload.contentType,
        data: combinedData,
      });
      this._multipartUploads.delete(uploadId);
      return `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
    <Location>${options.url.split("?")[0]}</Location>
    <Bucket>${this.bucketName}</Bucket>
    <Key>${key}</Key>
    <ETag>"${file}"</ETag>
</CompleteMultipartUploadResult>`;
    } else {
      throw new Error("Failed to combine multipart upload");
    }
  }
  abstract abortMultipartUpload(
    options: S3Server.Object.AbortMultipartUploadHandlerOptions,
  ): Promise<void>;

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.deleteObject({ key });
    }
  }
}
