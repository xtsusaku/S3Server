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
import { S3Error } from "../S3Error.js";

export default abstract class MetadataProvider<
  T extends S3Server.Object.Object = S3Server.Object.Object,
  Z extends S3Server.Object.Folder = S3Server.Object.Folder,
  R extends Record<string, any> = Record<string, any>,
> {
  constructor(
    protected bucketName: string | undefined = undefined,
    protected options: R,
  ) {}

  normalizeDate(data: Date | string | number): string {
    if (typeof data === "string") {
      return new Date(data).toISOString();
    }
    if (typeof data === "number") {
      return new Date(data).toISOString();
    }
    return data.toISOString();
  }

  getDate(data: Date | string | number): Date {
    if (typeof data === "string") {
      if (!data.includes("-")) {
        const isoFormatted = data.replace(
          /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
          "$1-$2-$3T$4:$5:$6Z",
        );
        const date = new Date(isoFormatted);
        return date;
      } else return new Date(data);
    }
    if (typeof data === "number") {
      return new Date(data);
    }
    return data;
  }

  abstract isBucketExist(
    bucketName: string,
    owner?: S3Server.Owner,
  ): Promise<S3Error | boolean>;

  abstract listBuckets(
    options?: S3Server.Bucket.ListBucketsOptions,
  ): Promise<S3Server.WithError<S3Server.Bucket.ListBucketsReturn>>;

  abstract createBucket(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>>;

  abstract deleteBucket(
    options: S3Server.Bucket.CreateDeleteBucketOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>>;

  abstract getFileMetadata(
    options: S3Server.Metadata.GetFileMetadataOptions,
  ): Promise<S3Server.WithError<T | null>>;

  abstract addFileMetadata(
    options: S3Server.Metadata.AddFileMetadataOptions,
  ): Promise<S3Server.WithError<T>>;

  abstract removeFileMetadata(
    options: S3Server.Metadata.RemoveFileMetadataOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>>;

  abstract getFolderMetadata(
    options: S3Server.Metadata.GetFolderMetadataOptions,
  ): Promise<S3Server.WithError<Z | null>>;

  abstract addFolderMetadata(
    options: S3Server.Metadata.AddFolderMetadataOptions,
  ): Promise<S3Server.WithError<Z>>;

  abstract removeFolderMetadata(
    options: S3Server.Metadata.RemoveFolderMetadataOptions,
  ): Promise<S3Server.WithError<{ isSuccess: boolean }>>;

  abstract get clazz(): {
    new (bucketName: string, options: any): MetadataProvider;
  };

  getBucketMetadata(bucketName: string): MetadataProvider {
    return new this.clazz(bucketName, this.options);
  }
}
