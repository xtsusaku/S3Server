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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import MetadataProvider from "../abs/MetadataProvider.js";
import { S3Error } from "../S3Error.js";

export type DefaultMetadataProviderOptions = {
  fileLocation?: string;
};

export default class DefaultMetadataProvider<
  T extends S3Server.Object.Object = S3Server.Object.Object,
  Z extends S3Server.Object.Folder = S3Server.Object.Folder,
  R extends Record<string, any> = DefaultMetadataProviderOptions,
> extends MetadataProvider<T, Z, R> {
  _fileLocation: string = "./metadata.json";
  _metadata: {
    [key: string]: {
      name: string;
      creationDate: string;
      size: number;
      owner?: S3Server.Owner;
      folder: Record<string, Z>;
      file: Record<string, T>;
    };
  } = {};

  constructor(
    bucketName: string | undefined = undefined,
    options: R = {} as R,
  ) {
    super(bucketName, options);
    this._fileLocation = options.fileLocation || this._fileLocation;
    this._metadata =
      JSON.parse(
        existsSync(this._fileLocation)
          ? readFileSync(this._fileLocation, "utf-8")
          : "{}",
      ) || {};

    this.saveToFile();
  }

  async isBucketExist(
    bucketName: string,
    owner?: S3Server.Owner,
  ): Promise<S3Error | boolean> {
    const bucket = this._metadata[bucketName];
    if (!bucket) {
      return new S3Error(
        "NoSuchBucket",
        "The specified bucket does not exist",
        404,
      );
    }
    if (!!owner && !!bucket.owner && bucket.owner.id !== owner.id) {
      return new S3Error("AccessDenied", "Access Denied", 403);
    }
    return !!bucket;
  }

  async listBuckets(
    options?: S3Server.Bucket.ListBucketsOptions,
  ): Promise<S3Server.WithError<S3Server.Bucket.ListBucketsReturn>> {
    let { prefix, maxBuckets = 100, continuationToken } = options || {};
    if (prefix) prefix = prefix.replace(/^\//, ""); // Remove leading slash if present
    const { limit, offset } = JSON.parse(
      Buffer.from(continuationToken || "", "base64").toString() || "{}",
    ) as { limit?: number; offset?: number };
    const allBuckets = Array.from(
      this._metadata ? Object.values(this._metadata) : [],
    )
      .filter((bucket) =>
        prefix
          ? bucket.name.toLowerCase().startsWith(prefix.toLowerCase())
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((bucket) => ({
        name: bucket.name,
        creationDate: this.getDate(bucket.creationDate),
      }));

    const paginatedBuckets = allBuckets.slice(
      offset || 0,
      (offset || 0) + (limit || maxBuckets),
    );
    const nextContinuationToken =
      offset !== undefined &&
      offset + (limit || maxBuckets) < allBuckets.length;

    return {
      data: {
        buckets: paginatedBuckets,
        owner: options?.owner,
        nextContinuationToken: nextContinuationToken
          ? Buffer.from(
              JSON.stringify({ limit, offset: offset + (limit || maxBuckets) }),
              "utf-8",
            ).toString("base64")
          : undefined,
      },
    };
  }

  async createBucket(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ): Promise<S3Server.WithError<{ isSuccess: true }>> {
    const { bucketName } = options;
    if (this._metadata[bucketName]) {
      return { errorCode: 409, error: "BucketAlreadyExists" };
    }
    this._metadata[bucketName] = {
      name: bucketName,
      creationDate: new Date().toISOString(),
      size: 0,
      folder: {
        "/": {
          key: "/",
          lastModified: new Date(),
          size: 0,
          md5Checksum: "",
          folderKeys: [] as string[],
          fileKeys: [] as string[],
        } as Z,
      },
      file: {},
    };
    this.saveToFile();
    return { data: { isSuccess: true } };
  }

  async deleteBucket(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ): Promise<S3Server.WithError<{ isSuccess: true }>> {
    const { bucketName } = options;
    if (!this._metadata[bucketName]) {
      return { errorCode: 404, error: "NoSuchBucket" };
    }
    if (Object.keys(this._metadata[bucketName].file).length > 0) {
      return { errorCode: 409, error: "BucketNotEmpty" };
    }
    delete this._metadata[bucketName];
    this.saveToFile();
    return { data: { isSuccess: true } };
  }

  getFileMetadata(
    options: S3Server.Metadata.GetFileMetadataOptions,
  ): Promise<S3Server.WithError<T | null>> {
    let { key } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      return Promise.resolve({
        data: (this._metadata[this.bucketName].file[key] as T) || undefined,
      });
    }
    return Promise.resolve({ errorCode: 404, error: "NoSuchKey" });
  }

  async addFileMetadata(
    options: S3Server.Metadata.AddFileMetadataOptions,
  ): Promise<S3Server.WithError<T>> {
    let { key, ...metadata } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      const parentKey =
        key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
      this._metadata[this.bucketName].file[key] = { key, ...metadata } as T;
      if (!this._metadata[this.bucketName].folder[parentKey]) {
        await this.addFolderMetadata({
          key: parentKey,
          lastModified: new Date(),
          size: 0,
        });
      }
      this._metadata[this.bucketName].folder[parentKey].fileKeys = [
        ...new Set([
          ...(this._metadata[this.bucketName].folder[parentKey]?.fileKeys ||
            []),
          key.replace(/^\/+/, "").replace(/\/+$/, ""),
        ]),
      ];
      this.saveToFile();
      return { data: metadata as T };
    }
    return { errorCode: 404, error: "NoSuchKey" };
  }

  async removeFileMetadata(
    options: S3Server.Metadata.RemoveFileMetadataOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>> {
    let { key, versionId } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      const parentKey =
        key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
      delete this._metadata[this.bucketName].file[key];
      if (this._metadata[this.bucketName].folder[parentKey]) {
        this._metadata[this.bucketName].folder[parentKey].fileKeys = (
          this._metadata[this.bucketName].folder[parentKey].fileKeys || []
        ).filter(
          (fileKey) => fileKey !== key.replace(/^\/+/, "").replace(/\/+$/, ""),
        );
      }
      if (key.endsWith("/.KEEP_THIS_FOR_FOLDER")) {
        const folderKey = key.replace(/\/\.KEEP_THIS_FOR_FOLDER$/, "") + "/";
        this.removeFolderMetadata({ key: folderKey });
      }
      this.saveToFile();
      return { data: { isSuccess: true } };
    }
    return { errorCode: 404, error: "NoSuchKey" };
  }

  getFolderMetadata(
    options: S3Server.Metadata.GetFolderMetadataOptions,
  ): Promise<S3Server.WithError<Z | null>> {
    let { key } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      return Promise.resolve({
        data: (this._metadata[this.bucketName].folder[key] as Z) || undefined,
      });
    }
    return Promise.resolve({ errorCode: 404, error: "NoSuchKey" });
  }

  async addFolderMetadata(
    options: S3Server.Metadata.AddFolderMetadataOptions,
  ): Promise<S3Server.WithError<Z>> {
    let { key, ..._metadata } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      const parentKey =
        key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
      const metadata = Object.assign({}, _metadata, {
        fileKeys: [],
        folderKeys: [],
      } as unknown as Z) as Z;
      if (!metadata.fileKeys?.includes(".KEEP_THIS_FOR_FOLDER")) {
        metadata.fileKeys?.push(".KEEP_THIS_FOR_FOLDER");
      }
      this._metadata[this.bucketName].folder[key] = metadata as Z;
      if (!this._metadata[this.bucketName].folder[parentKey]) {
        await this.addFolderMetadata({
          key: parentKey,
          lastModified: new Date(),
          size: 0,
        });
      }
      this._metadata[this.bucketName].folder[parentKey].folderKeys = [
        ...new Set([
          ...(this._metadata[this.bucketName].folder[parentKey].folderKeys ||
            []),
          `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`,
        ]),
      ];
      this.saveToFile();
      return { data: metadata as Z };
    }
    return { errorCode: 404, error: "NoSuchKey" };
  }

  async removeFolderMetadata(
    options: S3Server.Metadata.RemoveFolderMetadataOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>> {
    let { key } = options;
    key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.bucketName && this._metadata[this.bucketName]) {
      const parentKey =
        key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
      delete this._metadata[this.bucketName].folder[key];
      if (this._metadata[this.bucketName].folder[parentKey]) {
        this._metadata[this.bucketName].folder[parentKey].folderKeys = (
          this._metadata[this.bucketName].folder[parentKey].folderKeys || []
        ).filter(
          (folderKey) =>
            folderKey !== `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`,
        );
      }
      this.saveToFile();
      return { data: { isSuccess: true } };
    }
    return { errorCode: 404, error: "NoSuchKey" };
  }

  get clazz(): new (
    bucketName: string,
    options: Record<string, any>,
  ) => MetadataProvider {
    return this.constructor as new (
      bucketName: string,
      options: Record<string, any>,
    ) => MetadataProvider;
  }

  saveToFile(): void {
    writeFileSync(
      this._fileLocation,
      JSON.stringify(this._metadata, null, 2),
      "utf-8",
    );
  }
}
