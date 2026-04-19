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
import BucketSystem from "../abs/BucketSystem.js";
import DefaultObjectSystem from "./DefaultObjectSystem.js";
import DefaultMetadataProvider from "./DefaultMetadataProvider.js";
import { existsSync, writeFileSync } from "node:fs";

export default class DefaultBucketSystem extends BucketSystem {
  constructor(
    secretKey: string,
    _region: string,
    _metadataProviderClass = DefaultMetadataProvider,
    _metadataProviderOptions: ConstructorParameters<
      typeof _metadataProviderClass
    >[1] = {
      fileLocation: "./default_metadata.json",
    },
    _objectSystemClass = DefaultObjectSystem,
    _objectSystemOptions: ConstructorParameters<
      typeof _objectSystemClass
    >[2] = {},
    protected _fileLocation: string = "./buckets.json",
    protected owner = { id: "", displayName: "" },
  ) {
    super(
      secretKey,
      _region,
      _metadataProviderClass,
      _metadataProviderOptions,
      _objectSystemClass,
      _objectSystemOptions,
    );

    if (!existsSync(this._fileLocation)) {
      writeFileSync(
        this._fileLocation,
        JSON.stringify({ buckets: [] }, null, 2),
      );
    }

    // For Demo purposes, we initialize with a default bucket and object system.
    // this.buckets.set(
    //   "default",
    //   new _objectSystemClass(
    //     "default",
    //     this._metadataProvider.getBucketMetadata("default"),
    //     this._objectSystemOptions,
    //   ),
    // );
  }

  async getOwner(
    request?: Request,
  ): Promise<{ id: string; displayName: string }> {
    // In a real implementation, you would extract user information from the request
    // and verify it against your authentication system. For this default implementation,
    // we return a static owner.
    return this.owner;
  }
}
