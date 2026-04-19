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
import { Elysia } from "elysia";
import DefaultBucketSystem from "./api/default/DefaultBucketSystem.js";
import DefaultMetadataProvider from "./api/default/DefaultMetadataProvider.js";
import DefaultObjectSystem from "./api/default/DefaultObjectSystem.js";
import S3ServerClass from "./index";

export type S3ServerOptions = S3Server.S3ServerOptions;

export default function ElysiaS3Server({
  elysiaOptions = {},
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
  const app = new Elysia({
    ...elysiaOptions,
    name: "S3Server",
  }).all("/*", async ({ request }) => {
    const serverClass = new S3ServerClass({
      baseHost,
      iframeAllow,
      metadataProviderClass,
      metadataProviderOptions,
      objectSystemClass,
      objectSystemOptions,
      owner,
      region,
      bucketSystem,
    });
    const response = await serverClass.handleRequest(request);
    return response;
  });

  return app;
}
