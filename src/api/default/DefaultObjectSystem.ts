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
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import MetadataProvider from "../abs/MetadataProvider.js";
import ObjectSystem from "../abs/ObjectSystem.js";
import Stream, { Readable } from "node:stream";
import crypto from "node:crypto";
import { ReadableStream } from "node:stream/web";

export default class DefaultObjectSystem extends ObjectSystem<{
  folderLocation?: string;
  tmpLocation?: string;
}> {
  _folderLocation = "./default";
  _tmpLocation = "./tmp";
  _tmpStreams: Map<string, Stream> = new Map();

  constructor(
    bucketName: string,
    metadataProvider: MetadataProvider,
    options: {
      folderLocation?: string;
      tmpLocation?: string;
    },
  ) {
    super(bucketName, metadataProvider, options);
    this._folderLocation = options.folderLocation || "./default";
    this._tmpLocation = options.tmpLocation || "./tmp";

    if (!existsSync(this._folderLocation)) {
      mkdirSync(this._folderLocation, { recursive: true });
    }

    if (!existsSync(this._tmpLocation)) {
      mkdirSync(this._tmpLocation, { recursive: true });
    }

    // For demo purposes, we add a test item to the metadata on initialization.
    // this.metadataProvider.addFileMetadata({
    //   filePath: `data/TESTItem.txt`,
    //   metadata: {
    //     key: "data/TESTItem.txt",
    //     lastModified: new Date(),
    //     size: 1024,
    //     md5Checksum: "bf19a1bf90eba98fa27a6752bfa66ee5",
    //   },
    // });
    this.putObject({
      key: "data/TESTItem.txt",
      data: "This is a test item.",
    });
  }

  // Fixed
  async listObjects({
    prefix = "/",
    maxKeys = 1000,
    continuationToken,
  }: S3Server.Object.ListObjectsV2HandlerOptions): Promise<S3Server.Object.ListObjectsV2Return> {
    let offset: number = 0;
    let limit: number = maxKeys;
    if (continuationToken) {
      const decoded = Buffer.from(continuationToken, "base64").toString(
        "utf-8",
      );
      const [offsetStr, limitStr] = decoded.split(":");
      offset = parseInt(offsetStr, 10);
      limit = parseInt(limitStr, 10);
    } else {
      offset = offset || 0;
      limit = limit || maxKeys;
    }
    const bucketMetadata = await this.metadataProvider.getFolderMetadata({
      key: prefix.replace(/^\//g, "").replace(/\/?[^\/]*$/, ""),
      limit,
      offset,
    });
    if (!bucketMetadata.data) {
      return {
        folders: [],
        files: [],
        nextContinuationToken: undefined,
      };
    }
    const files: S3Server.Object.ListObjectsV2Return["files"] = [];
    const folders: S3Server.Object.ListObjectsV2Return["folders"] = [];
    const totalKeys = [
      ...(bucketMetadata.data.folderKeys?.sort() || []),
      ...(bucketMetadata.data.fileKeys?.sort() || []),
    ];
    for await (const key of totalKeys.slice(offset, offset + limit)) {
      if (key.endsWith("/")) {
        folders.push({
          key,
        });
      } else {
        const metadata = await this.metadataProvider.getFileMetadata({ key });
        files.push(
          Object.assign(
            {
              key,
              lastModified: new Date(),
              size: 0,
              md5Checksum: crypto.createHash("md5").update(key).digest("hex"),
            },
            metadata.data,
          ),
        );
      }
    }
    let nextContinuationToken: string | undefined =
      offset + limit < totalKeys.length
        ? Buffer.from(`${offset + limit}:${limit}`).toString("base64")
        : undefined;
    return {
      folders,
      files,
      nextContinuationToken,
    };
  }

  // Fixed
  async putObject(
    options: S3Server.Object.PutObjectHandlerOptions,
  ): Promise<string | undefined> {
    const { key, contentType, data, checksumAlgorithm, checksumType } = options;
    if (data) {
      const folderPath = `${this._folderLocation}/${key
        .split("/")
        .slice(0, -1)
        .join("/")
        .replace(/^\//g, "")
        .replace(/\/[^\/]+$/, "")}`;
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true });
      }
      const { md5Checksum, size } = await new Promise<{
        md5Checksum: string;
        size: number;
      }>((resolve) => {
        if (data instanceof ReadableStream || data instanceof Readable) {
          const fileStream = createWriteStream(
            `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
          );

          // Convert Web ReadableStream to Node.js Readable Stream
          const nodeStream =
            data instanceof Readable ? data : Readable.from(data);

          const hash = crypto.createHash("md5");
          nodeStream.on("data", (chunk) => {
            hash.update(chunk);
          });
          nodeStream.pipe(fileStream);

          // fileStream.on("finish", () => resolve(undefined));
          fileStream.on("finish", () => {
            const md5Checksum = hash.digest("hex");
            resolve({
              md5Checksum,
              size: statSync(
                `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
              ).size,
            });
          });
          // fileStream.on("error", reject);
        } else {
          writeFileSync(
            `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
            data,
          );

          const md5Checksum = crypto
            .createHash("md5")
            .update(data)
            .digest("hex");
          return resolve({
            md5Checksum,
            size: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data),
          });
        }
      });
      await this.metadataProvider.addFileMetadata({
        key: key.replace(/^\//g, ""),
        contentType,
        lastModified: new Date(),
        size,
        md5Checksum,
      });
      return md5Checksum;
    } else {
      mkdirSync(
        `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
        {
          recursive: true,
        },
      );
      await this.metadataProvider.addFolderMetadata({
        key: key.replace(/^\//g, "").replace(/\/$/g, "") + "/",
        lastModified: new Date(),
        size: 0,
        md5Checksum: undefined,
        folderKeys: [],
        fileKeys: [],
      });
      return undefined;
    }
  }

  // Fixed
  async headObject(key: string): Promise<S3Server.Object.GetHeadObjectReturn> {
    if (
      !existsSync(
        `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
      )
    ) {
      return {
        data: Buffer.from(""),
      };
    }
    const metadata = await this.metadataProvider.getFileMetadata({ key });

    return {
      data: undefined,
      eTag: metadata?.data?.md5Checksum,
      lastModified: metadata?.data?.lastModified,
      contentLength: metadata?.data?.size,
    };
  }

  // Fixed
  async getObject(
    key: string,
    range?: string,
  ): Promise<S3Server.Object.GetHeadObjectReturn> {
    if (
      !existsSync(
        `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
      )
    ) {
      return {
        data: Buffer.from(""),
      };
    }
    const metadata = await this.metadataProvider.getFileMetadata({ key });

    const filePath = `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : metadata?.data?.size || 0;
      const fileStream = createReadStream(filePath, { start, end });
      return {
        data: Readable.toWeb(fileStream),
        contentType: metadata?.data?.contentType,
        eTag: metadata?.data?.md5Checksum,
        lastModified: metadata?.data?.lastModified,
        contentLength: metadata?.data?.size,
      };
    }

    const fileStream = createReadStream(filePath);
    return {
      data: Readable.toWeb(fileStream),
      contentType: metadata?.data?.contentType,
      eTag: metadata?.data?.md5Checksum,
      lastModified: metadata?.data?.lastModified,
      contentLength: metadata?.data?.size,
    };
  }

  async handleUploadPart(
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<string> {
    const partPath = `${this._tmpLocation}/${uploadId}_${partNumber}`;
    writeFileSync(partPath, data);
    return crypto.createHash("md5").update(data).digest("hex");
  }

  async getCompleteMultipartCombine(
    uploadId: string,
    parts: S3Server.Object.CompleteMultipartUploadHandlerOptions["parts"],
  ): Promise<Buffer | Readable | undefined> {
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const tmpLocation = this._tmpLocation;

    // Define an async generator that yields chunks from each file sequentially
    async function* generateChunks() {
      for (const part of sortedParts) {
        const partPath = `${tmpLocation}/${uploadId}_${part.partNumber}`;

        if (!existsSync(partPath)) {
          throw new Error(
            `Part ${part.partNumber} not found for upload ID ${uploadId}`,
          );
        }

        const readStream = createReadStream(partPath);

        // Yield every chunk from the current part
        for await (const chunk of readStream) {
          yield chunk;
        }

        // Optional: Delete part immediately after streaming it to save disk space
        rmSync(partPath);
      }
    }

    // Create a Node.js Readable Stream from the generator
    // This stream handles backpressure correctly:
    // If the consumer stops reading, the generator pauses.
    return Readable.from(generateChunks());
  }

  abortMultipartUpload(
    options: S3Server.Object.AbortMultipartUploadHandlerOptions,
  ): Promise<void> {
    return new Promise((resolve) => {
      const { key, uploadId } = options;
      const upload = this._multipartUploads.get(uploadId);

      if (upload && upload.key === key) {
        setTimeout(() => {
          const parts = readdirSync(this._tmpLocation).filter((file) =>
            file.startsWith(`${uploadId}_`),
          );
          for (const partFile of parts) {
            const part = `${this._tmpLocation}/${partFile}`;
            if (existsSync(part)) {
              rmSync(part);
            }
          }

          this._multipartUploads.delete(uploadId);
          return resolve();
        }, 100);
      } else return resolve();
    });
  }

  // Fixed
  async deleteObject(
    options: S3Server.Object.DeleteObjectHandlerOptions,
  ): Promise<void> {
    const { key } = options;
    if (key.endsWith("/")) {
      await this.metadataProvider.removeFolderMetadata({
        key: key.replace(/^\//g, ""),
      });
      rmSync(
        `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
        {
          recursive: true,
          force: true,
        },
      );
    } else {
      await this.metadataProvider.removeFileMetadata({
        key: key.replace(/^\//g, ""),
      });
      rmSync(`${this._folderLocation}/${key.replace(/^\//g, "")}`, {
        force: true,
      });
    }
    return;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    let folderKeys: string[] = [];
    let fileKeys: string[] = [];
    for (const key of keys) {
      if (key.endsWith("/")) {
        rmSync(
          `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`,
          {
            recursive: true,
            force: true,
          },
        );
        folderKeys.push(key.replace(/^\//g, ""));
      } else {
        rmSync(`${this._folderLocation}/${key.replace(/^\//g, "")}`, {
          force: true,
        });
        fileKeys.push(key.replace(/^\//g, ""));
      }
    }
    if (folderKeys.length > 0)
      await Promise.all(
        folderKeys
          .map((key) => key.replace(/^\//g, ""))
          .map((key) => this.metadataProvider.removeFolderMetadata({ key })),
      );
    if (fileKeys.length > 0)
      await Promise.all(
        fileKeys
          .map((key) => key.replace(/^\//g, ""))
          .map((key) => this.metadataProvider.removeFileMetadata({ key })),
      );
    return;
  }
}
