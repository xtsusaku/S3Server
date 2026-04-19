import { Readable } from "node:stream";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { ReadableStream } from "node:stream/web";
import crypto$1, { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
//#region src/api/abs/MetadataProvider.ts
var MetadataProvider = class {
	constructor(bucketName = void 0, options) {
		this.bucketName = bucketName;
		this.options = options;
	}
	normalizeDate(data) {
		if (typeof data === "string") return new Date(data).toISOString();
		if (typeof data === "number") return new Date(data).toISOString();
		return data.toISOString();
	}
	getDate(data) {
		if (typeof data === "string") if (!data.includes("-")) {
			const isoFormatted = data.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z");
			return new Date(isoFormatted);
		} else return new Date(data);
		if (typeof data === "number") return new Date(data);
		return data;
	}
	getBucketMetadata(bucketName) {
		return new this.clazz(bucketName, this.options);
	}
};
//#endregion
//#region src/api/S3Error.ts
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
var S3Error = class S3Error extends Error {
	code;
	httpStatus;
	requestId;
	hostId;
	bucketName;
	key;
	constructor(code, message, httpStatus = 500, options) {
		super(message);
		this.name = "S3Error";
		this.code = code;
		this.httpStatus = httpStatus;
		this.requestId = globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.hostId = options?.hostId || "s3-clone-host";
		this.bucketName = options?.bucketName;
		this.key = options?.key;
		Object.setPrototypeOf(this, S3Error.prototype);
	}
	/** Minimal XML serializer matching AWS S3 error format */
	toXML() {
		const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
		let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error>\n`;
		xml += `  <Code>${esc(this.code)}</Code>\n`;
		xml += `  <Message>${esc(this.message)}</Message>\n`;
		if (this.bucketName) xml += `  <BucketName>${esc(this.bucketName)}</BucketName>\n`;
		if (this.key) xml += `  <Key>${esc(this.key)}</Key>\n`;
		xml += `  <RequestId>${esc(this.requestId)}</RequestId>\n`;
		xml += `  <HostId>${esc(this.hostId)}</HostId>\n`;
		xml += `</Error>`;
		return xml;
	}
	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			httpStatus: this.httpStatus,
			requestId: this.requestId,
			bucketName: this.bucketName,
			key: this.key,
			stack: process.env.NODE_ENV === "development" ? this.stack : void 0
		};
	}
};
//#endregion
//#region src/api/default/DefaultMetadataProvider.ts
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
var DefaultMetadataProvider = class extends MetadataProvider {
	_fileLocation = "./metadata.json";
	_metadata = {};
	constructor(bucketName = void 0, options = {}) {
		super(bucketName, options);
		this._fileLocation = options.fileLocation || this._fileLocation;
		this._metadata = JSON.parse(existsSync(this._fileLocation) ? readFileSync(this._fileLocation, "utf-8") : "{}") || {};
		this.saveToFile();
	}
	async isBucketExist(bucketName, owner) {
		const bucket = this._metadata[bucketName];
		if (!bucket) return new S3Error("NoSuchBucket", "The specified bucket does not exist", 404);
		if (!!owner && !!bucket.owner && bucket.owner.id !== owner.id) return new S3Error("AccessDenied", "Access Denied", 403);
		return !!bucket;
	}
	async listBuckets(options) {
		let { prefix, maxBuckets = 100, continuationToken } = options || {};
		if (prefix) prefix = prefix.replace(/^\//, "");
		const { limit, offset } = JSON.parse(Buffer.from(continuationToken || "", "base64").toString() || "{}");
		const allBuckets = Array.from(this._metadata ? Object.values(this._metadata) : []).filter((bucket) => prefix ? bucket.name.toLowerCase().startsWith(prefix.toLowerCase()) : true).sort((a, b) => a.name.localeCompare(b.name)).map((bucket) => ({
			name: bucket.name,
			creationDate: this.getDate(bucket.creationDate)
		}));
		const paginatedBuckets = allBuckets.slice(offset || 0, (offset || 0) + (limit || maxBuckets));
		const nextContinuationToken = offset !== void 0 && offset + (limit || maxBuckets) < allBuckets.length;
		return { data: {
			buckets: paginatedBuckets,
			owner: options?.owner,
			nextContinuationToken: nextContinuationToken ? Buffer.from(JSON.stringify({
				limit,
				offset: offset + (limit || maxBuckets)
			}), "utf-8").toString("base64") : void 0
		} };
	}
	async createBucket(options) {
		const { bucketName } = options;
		if (this._metadata[bucketName]) return {
			errorCode: 409,
			error: "BucketAlreadyExists"
		};
		this._metadata[bucketName] = {
			name: bucketName,
			creationDate: (/* @__PURE__ */ new Date()).toISOString(),
			size: 0,
			folder: { "/": {
				key: "/",
				lastModified: /* @__PURE__ */ new Date(),
				size: 0,
				md5Checksum: "",
				folderKeys: [],
				fileKeys: []
			} },
			file: {}
		};
		this.saveToFile();
		return { data: { isSuccess: true } };
	}
	async deleteBucket(options) {
		const { bucketName } = options;
		if (!this._metadata[bucketName]) return {
			errorCode: 404,
			error: "NoSuchBucket"
		};
		if (Object.keys(this._metadata[bucketName].file).length > 0) return {
			errorCode: 409,
			error: "BucketNotEmpty"
		};
		delete this._metadata[bucketName];
		this.saveToFile();
		return { data: { isSuccess: true } };
	}
	getFileMetadata(options) {
		let { key } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) return Promise.resolve({ data: this._metadata[this.bucketName].file[key] || void 0 });
		return Promise.resolve({
			errorCode: 404,
			error: "NoSuchKey"
		});
	}
	async addFileMetadata(options) {
		let { key, ...metadata } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) {
			const parentKey = key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
			this._metadata[this.bucketName].file[key] = {
				key,
				...metadata
			};
			if (!this._metadata[this.bucketName].folder[parentKey]) await this.addFolderMetadata({
				key: parentKey,
				lastModified: /* @__PURE__ */ new Date(),
				size: 0
			});
			this._metadata[this.bucketName].folder[parentKey].fileKeys = [...new Set([...this._metadata[this.bucketName].folder[parentKey]?.fileKeys || [], key.replace(/^\/+/, "").replace(/\/+$/, "")])];
			this.saveToFile();
			return { data: metadata };
		}
		return {
			errorCode: 404,
			error: "NoSuchKey"
		};
	}
	async removeFileMetadata(options) {
		let { key, versionId } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) {
			const parentKey = key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
			delete this._metadata[this.bucketName].file[key];
			if (this._metadata[this.bucketName].folder[parentKey]) this._metadata[this.bucketName].folder[parentKey].fileKeys = (this._metadata[this.bucketName].folder[parentKey].fileKeys || []).filter((fileKey) => fileKey !== key.replace(/^\/+/, "").replace(/\/+$/, ""));
			if (key.endsWith("/.KEEP_THIS_FOR_FOLDER")) {
				const folderKey = key.replace(/\/\.KEEP_THIS_FOR_FOLDER$/, "") + "/";
				this.removeFolderMetadata({ key: folderKey });
			}
			this.saveToFile();
			return { data: { isSuccess: true } };
		}
		return {
			errorCode: 404,
			error: "NoSuchKey"
		};
	}
	getFolderMetadata(options) {
		let { key } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) return Promise.resolve({ data: this._metadata[this.bucketName].folder[key] || void 0 });
		return Promise.resolve({
			errorCode: 404,
			error: "NoSuchKey"
		});
	}
	async addFolderMetadata(options) {
		let { key, ..._metadata } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) {
			const parentKey = key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
			const metadata = Object.assign({}, _metadata, {
				fileKeys: [],
				folderKeys: []
			});
			if (!metadata.fileKeys?.includes(".KEEP_THIS_FOR_FOLDER")) metadata.fileKeys?.push(".KEEP_THIS_FOR_FOLDER");
			this._metadata[this.bucketName].folder[key] = metadata;
			if (!this._metadata[this.bucketName].folder[parentKey]) await this.addFolderMetadata({
				key: parentKey,
				lastModified: /* @__PURE__ */ new Date(),
				size: 0
			});
			this._metadata[this.bucketName].folder[parentKey].folderKeys = [...new Set([...this._metadata[this.bucketName].folder[parentKey].folderKeys || [], `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`])];
			this.saveToFile();
			return { data: metadata };
		}
		return {
			errorCode: 404,
			error: "NoSuchKey"
		};
	}
	async removeFolderMetadata(options) {
		let { key } = options;
		key = key === "/" ? "/" : "/" + key.replace(/^\/+/, "").replace(/\/+$/, "");
		if (this.bucketName && this._metadata[this.bucketName]) {
			const parentKey = key === "/" ? "/" : key.replace(/\/?[^\/]+\/?$/, "") || "/";
			delete this._metadata[this.bucketName].folder[key];
			if (this._metadata[this.bucketName].folder[parentKey]) this._metadata[this.bucketName].folder[parentKey].folderKeys = (this._metadata[this.bucketName].folder[parentKey].folderKeys || []).filter((folderKey) => folderKey !== `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`);
			this.saveToFile();
			return { data: { isSuccess: true } };
		}
		return {
			errorCode: 404,
			error: "NoSuchKey"
		};
	}
	get clazz() {
		return this.constructor;
	}
	saveToFile() {
		writeFileSync(this._fileLocation, JSON.stringify(this._metadata, null, 2), "utf-8");
	}
};
//#endregion
//#region src/api/abs/ObjectSystem.ts
var ObjectSystem = class {
	_multipartUploads = /* @__PURE__ */ new Map();
	constructor(bucketName, metadataProvider, options) {
		this.bucketName = bucketName;
		this.metadataProvider = metadataProvider;
	}
	async ensureBuffer(data) {
		let BufferData;
		if (data instanceof Buffer) BufferData = data;
		else if (data instanceof ReadableStream) {
			let buffers = [];
			const reader = data.getReader();
			let done = false;
			while (!done) {
				const { value, done: doneReading } = await reader.read();
				if (value) buffers.push(value);
				done = doneReading;
			}
			BufferData = Buffer.concat(buffers.map((b) => Buffer.from(b)));
		} else if (data instanceof Readable) {
			let buffers = [];
			for await (const chunk of data) buffers.push(chunk);
			BufferData = Buffer.concat(buffers);
		} else if (typeof data === "string") BufferData = Buffer.from(data);
		if (!BufferData) throw new Error("Data must be a Buffer, ReadableStream, Readable, or string");
		return BufferData;
	}
	async listObjectsV2Handler(options = {}) {
		options.listType = options.listType || "2";
		if (options.listType !== "2") return new S3Error("ListObjectsV2Only", "Only list-type 2 is supported");
		let { prefix, delimiter = "/", maxKeys = 1e3, continuationToken, encodingType, startAfter, expectedBucketOwner } = options;
		prefix = prefix && prefix !== "" && prefix !== "/" ? "/" + prefix.replace(/^\/+/g, "").replace(/\/+$/g, "") + "/" : "/";
		const { folders, files, nextContinuationToken } = await this.listObjects(options);
		const contentXml = files.map((file) => `
      <Contents>
        <Key>${file.key}</Key>
        ${file.lastModified ? `<LastModified>${typeof file.lastModified === "string" ? file.lastModified : file.lastModified.toISOString()}</LastModified>` : ""}
        ${file.size !== void 0 ? `<Size>${file.size}</Size>` : ""}
        ${file.md5Checksum ? `<ETag>"${file.md5Checksum}"</ETag>` : ""}
      </Contents>`).join("");
		const commonPrefixesXml = folders.map((folder) => `
      <CommonPrefixes>
        <Prefix>${folder.key.replace(/^\/+/, "").replace(/\/+$/, "")}</Prefix>
      </CommonPrefixes>`).join("");
		return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
    <Name>${this.bucketName}</Name>
    ${prefix ? `<Prefix>${prefix}</Prefix>` : ""}
    <KeyCount>${files.length}</KeyCount>
    <MaxKeys>${maxKeys}</MaxKeys>
    <Delimiter>${delimiter}</Delimiter>
    <IsTruncated>false</IsTruncated>
    ${contentXml}
    ${commonPrefixesXml}
    ${continuationToken ? `<ContinuationToken>${continuationToken}</ContinuationToken>` : ""}
    ${nextContinuationToken ? `<NextContinuationToken>${nextContinuationToken}</NextContinuationToken>` : ""}
    ${encodingType ? `<EncodingType>${encodingType}</EncodingType>` : ""}
    ${startAfter ? `<StartAfter>${startAfter}</StartAfter>` : ""}
</ListBucketResult>`;
	}
	async putObjectHandler(options) {
		const { key, data, contentType, checksumAlgorithm, checksumType } = options;
		return await this.putObject(options);
	}
	async headObjectHandler(key) {
		return await this.headObject(key);
	}
	async getObjectHandler(key, range) {
		key = key.replace(/^\//g, "");
		return await this.getObject(key, range);
	}
	async deleteObjectHandler(options) {
		await this.deleteObject(options);
	}
	async createMultipartUploadHandler(options) {
		let { key, contentType } = options;
		key = "/" + key.replace(/^\//g, "");
		const uploadId = crypto.randomUUID();
		this._multipartUploads.set(uploadId, {
			key,
			contentType: contentType || "application/octet-stream",
			parts: []
		});
		return `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Bucket>${this.bucketName}</Bucket>
    <Key>${key}</Key>
    <UploadId>${uploadId}</UploadId>
</InitiateMultipartUploadResult>`;
	}
	async uploadPartHandler(options) {
		let { key, partNumber, uploadId, data, checksumAlgorithm, checksumType } = options;
		key = "/" + key.replace(/^\/+/g, "");
		const upload = this._multipartUploads.get(uploadId);
		if (!upload) throw new Error("Invalid upload ID");
		if (upload.key !== key) throw new Error("Key does not match upload ID");
		return await this.handleUploadPart(uploadId, partNumber, data);
	}
	async completeMultipartUploadHandler(options) {
		const { key, uploadId, parts } = options;
		const upload = this._multipartUploads.get(uploadId);
		if (!upload) throw new Error("Invalid upload ID");
		if (upload.key !== key) throw new Error("Key does not match upload ID");
		const combinedData = await this.getCompleteMultipartCombine(uploadId, parts);
		if (combinedData) {
			const file = await this.putObject({
				key,
				contentType: upload.contentType,
				data: combinedData
			});
			this._multipartUploads.delete(uploadId);
			return `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
    <Location>${options.url.split("?")[0]}</Location>
    <Bucket>${this.bucketName}</Bucket>
    <Key>${key}</Key>
    <ETag>"${file}"</ETag>
</CompleteMultipartUploadResult>`;
		} else throw new Error("Failed to combine multipart upload");
	}
	async deleteObjects(keys) {
		for (const key of keys) await this.deleteObject({ key });
	}
};
//#endregion
//#region src/api/default/DefaultObjectSystem.ts
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
var DefaultObjectSystem = class extends ObjectSystem {
	_folderLocation = "./default";
	_tmpLocation = "./tmp";
	_tmpStreams = /* @__PURE__ */ new Map();
	constructor(bucketName, metadataProvider, options) {
		super(bucketName, metadataProvider, options);
		this._folderLocation = options.folderLocation || "./default";
		this._tmpLocation = options.tmpLocation || "./tmp";
		if (!existsSync(this._folderLocation)) mkdirSync(this._folderLocation, { recursive: true });
		if (!existsSync(this._tmpLocation)) mkdirSync(this._tmpLocation, { recursive: true });
		this.putObject({
			key: "data/TESTItem.txt",
			data: "This is a test item."
		});
	}
	async listObjects({ prefix = "/", maxKeys = 1e3, continuationToken }) {
		let offset = 0;
		let limit = maxKeys;
		if (continuationToken) {
			const [offsetStr, limitStr] = Buffer.from(continuationToken, "base64").toString("utf-8").split(":");
			offset = parseInt(offsetStr, 10);
			limit = parseInt(limitStr, 10);
		} else {
			offset = offset || 0;
			limit = limit || maxKeys;
		}
		const bucketMetadata = await this.metadataProvider.getFolderMetadata({
			key: prefix.replace(/^\//g, "").replace(/\/?[^\/]*$/, ""),
			limit,
			offset
		});
		if (!bucketMetadata.data) return {
			folders: [],
			files: [],
			nextContinuationToken: void 0
		};
		const files = [];
		const folders = [];
		const totalKeys = [...bucketMetadata.data.folderKeys?.sort() || [], ...bucketMetadata.data.fileKeys?.sort() || []];
		for await (const key of totalKeys.slice(offset, offset + limit)) if (key.endsWith("/")) folders.push({ key });
		else {
			const metadata = await this.metadataProvider.getFileMetadata({ key });
			files.push(Object.assign({
				key,
				lastModified: /* @__PURE__ */ new Date(),
				size: 0,
				md5Checksum: crypto$1.createHash("md5").update(key).digest("hex")
			}, metadata.data));
		}
		return {
			folders,
			files,
			nextContinuationToken: offset + limit < totalKeys.length ? Buffer.from(`${offset + limit}:${limit}`).toString("base64") : void 0
		};
	}
	async putObject(options) {
		const { key, contentType, data, checksumAlgorithm, checksumType } = options;
		if (data) {
			const folderPath = `${this._folderLocation}/${key.split("/").slice(0, -1).join("/").replace(/^\//g, "").replace(/\/[^\/]+$/, "")}`;
			if (!existsSync(folderPath)) mkdirSync(folderPath, { recursive: true });
			const { md5Checksum, size } = await new Promise((resolve) => {
				if (data instanceof ReadableStream || data instanceof Readable) {
					const fileStream = createWriteStream(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`);
					const nodeStream = data instanceof Readable ? data : Readable.from(data);
					const hash = crypto$1.createHash("md5");
					nodeStream.on("data", (chunk) => {
						hash.update(chunk);
					});
					nodeStream.pipe(fileStream);
					fileStream.on("finish", () => {
						resolve({
							md5Checksum: hash.digest("hex"),
							size: statSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`).size
						});
					});
				} else {
					writeFileSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`, data);
					return resolve({
						md5Checksum: crypto$1.createHash("md5").update(data).digest("hex"),
						size: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)
					});
				}
			});
			await this.metadataProvider.addFileMetadata({
				key: key.replace(/^\//g, ""),
				contentType,
				lastModified: /* @__PURE__ */ new Date(),
				size,
				md5Checksum
			});
			return md5Checksum;
		} else {
			mkdirSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`, { recursive: true });
			await this.metadataProvider.addFolderMetadata({
				key: key.replace(/^\//g, "").replace(/\/$/g, "") + "/",
				lastModified: /* @__PURE__ */ new Date(),
				size: 0,
				md5Checksum: void 0,
				folderKeys: [],
				fileKeys: []
			});
			return;
		}
	}
	async headObject(key) {
		if (!existsSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`)) return { data: Buffer.from("") };
		const metadata = await this.metadataProvider.getFileMetadata({ key });
		return {
			data: void 0,
			eTag: metadata?.data?.md5Checksum,
			lastModified: metadata?.data?.lastModified,
			contentLength: metadata?.data?.size
		};
	}
	async getObject(key, range) {
		if (!existsSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`)) return { data: Buffer.from("") };
		const metadata = await this.metadataProvider.getFileMetadata({ key });
		const filePath = `${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`;
		if (range) {
			const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
			const fileStream = createReadStream(filePath, {
				start: parseInt(startStr, 10),
				end: endStr ? parseInt(endStr, 10) : metadata?.data?.size || 0
			});
			return {
				data: Readable.toWeb(fileStream),
				contentType: metadata?.data?.contentType,
				eTag: metadata?.data?.md5Checksum,
				lastModified: metadata?.data?.lastModified,
				contentLength: metadata?.data?.size
			};
		}
		const fileStream = createReadStream(filePath);
		return {
			data: Readable.toWeb(fileStream),
			contentType: metadata?.data?.contentType,
			eTag: metadata?.data?.md5Checksum,
			lastModified: metadata?.data?.lastModified,
			contentLength: metadata?.data?.size
		};
	}
	async handleUploadPart(uploadId, partNumber, data) {
		writeFileSync(`${this._tmpLocation}/${uploadId}_${partNumber}`, data);
		return crypto$1.createHash("md5").update(data).digest("hex");
	}
	async getCompleteMultipartCombine(uploadId, parts) {
		const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
		const tmpLocation = this._tmpLocation;
		async function* generateChunks() {
			for (const part of sortedParts) {
				const partPath = `${tmpLocation}/${uploadId}_${part.partNumber}`;
				if (!existsSync(partPath)) throw new Error(`Part ${part.partNumber} not found for upload ID ${uploadId}`);
				const readStream = createReadStream(partPath);
				for await (const chunk of readStream) yield chunk;
				rmSync(partPath);
			}
		}
		return Readable.from(generateChunks());
	}
	abortMultipartUpload(options) {
		return new Promise((resolve) => {
			const { key, uploadId } = options;
			const upload = this._multipartUploads.get(uploadId);
			if (upload && upload.key === key) setTimeout(() => {
				const parts = readdirSync(this._tmpLocation).filter((file) => file.startsWith(`${uploadId}_`));
				for (const partFile of parts) {
					const part = `${this._tmpLocation}/${partFile}`;
					if (existsSync(part)) rmSync(part);
				}
				this._multipartUploads.delete(uploadId);
				return resolve();
			}, 100);
			else return resolve();
		});
	}
	async deleteObject(options) {
		const { key } = options;
		if (key.endsWith("/")) {
			await this.metadataProvider.removeFolderMetadata({ key: key.replace(/^\//g, "") });
			rmSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`, {
				recursive: true,
				force: true
			});
		} else {
			await this.metadataProvider.removeFileMetadata({ key: key.replace(/^\//g, "") });
			rmSync(`${this._folderLocation}/${key.replace(/^\//g, "")}`, { force: true });
		}
	}
	async deleteObjects(keys) {
		let folderKeys = [];
		let fileKeys = [];
		for (const key of keys) if (key.endsWith("/")) {
			rmSync(`${this._folderLocation}/${key.replace(/^\//g, "").replace(/^\//g, "")}`, {
				recursive: true,
				force: true
			});
			folderKeys.push(key.replace(/^\//g, ""));
		} else {
			rmSync(`${this._folderLocation}/${key.replace(/^\//g, "")}`, { force: true });
			fileKeys.push(key.replace(/^\//g, ""));
		}
		if (folderKeys.length > 0) await Promise.all(folderKeys.map((key) => key.replace(/^\//g, "")).map((key) => this.metadataProvider.removeFolderMetadata({ key })));
		if (fileKeys.length > 0) await Promise.all(fileKeys.map((key) => key.replace(/^\//g, "")).map((key) => this.metadataProvider.removeFileMetadata({ key })));
	}
};
//#endregion
//#region src/api/validators/bucket-name.ts
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
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$/;
function validateBucketName(name) {
	if (!name) return "BucketNameTooShort";
	if (name.length < 3) return "BucketNameTooShort";
	if (name.length > 63) return "BucketNameTooLong";
	if (!BUCKET_NAME_RE.test(name)) return "InvalidBucketName";
	if (name.includes("..")) return "InvalidBucketName";
	if (name.startsWith("xn--")) return "InvalidBucketName";
	if (name.endsWith("-s3alias")) return "InvalidBucketName";
	if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "InvalidBucketName";
	return null;
}
//#endregion
//#region src/api/abs/BucketSystem.ts
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
var BucketSystem = class {
	buckets = /* @__PURE__ */ new Map();
	_metadataProvider;
	constructor(_secretKey, _region, _metadataProviderClass = DefaultMetadataProvider, _metadataProviderOptions = {}, _objectSystemClass = DefaultObjectSystem, _objectSystemOptions = {}) {
		this._secretKey = _secretKey;
		this._region = _region;
		this._metadataProviderClass = _metadataProviderClass;
		this._metadataProviderOptions = _metadataProviderOptions;
		this._objectSystemClass = _objectSystemClass;
		this._objectSystemOptions = _objectSystemOptions;
		this._metadataProvider = new this._metadataProviderClass(void 0, this._metadataProviderOptions);
	}
	getDate(data) {
		return this._metadataProvider.getDate(data);
	}
	normalizeDate(data) {
		return this._metadataProvider.normalizeDate(data);
	}
	getSecretKey(request) {
		return this._secretKey;
	}
	getAccessDeniedResponse(requestId) {
		return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied</Message>
  <RequestId>${requestId || crypto.randomUUID()}</RequestId>
</Error>`;
	}
	async isBucketExist(bucketName, owner, reqOwner = false) {
		if (reqOwner && !owner) return new S3Error("AccessDenied", "Access Denied", 403, { bucketName });
		return this._metadataProvider.isBucketExist(bucketName, owner);
	}
	async listsBucketsHandler(options) {
		let owner = {
			id: options.request.headers.get("x-amz-user-id") || "unknown",
			displayName: options.request.headers.get("x-amz-user-name") || "unknown"
		};
		if (owner.id === "unknown" || owner.displayName === "unknown") {
			const extractedOwner = await this.getOwner(options.request);
			owner = {
				id: extractedOwner.id || owner.id,
				displayName: extractedOwner.displayName || owner.displayName
			};
		}
		const buckets = await this._metadataProvider.listBuckets({
			request: options.request,
			owner,
			maxBuckets: options.maxBuckets || 100,
			prefix: options.prefix,
			continuationToken: options.continuationToken
		});
		if (buckets.data && !buckets.errorCode) return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    ${buckets.data.buckets.map((bucket) => `
      <Bucket>
        <Name>${bucket.name}</Name>
        ${bucket.creationDate ? `<CreationDate>${this._metadataProvider.normalizeDate(bucket.creationDate)}</CreationDate>` : ""}
        ${bucket.region ? `<Region>${bucket.region}</Region>` : ""}
      </Bucket>`).join("")}
  </Buckets>
  <Owner>
    <ID>${owner.id}</ID>
    <DisplayName>${owner.displayName}</DisplayName>
  </Owner>
  ${buckets.data.nextContinuationToken ? `<ContinuationToken>${buckets.data.nextContinuationToken}</ContinuationToken>` : ""}
  ${options.prefix ? `<Prefix>${options.prefix}</Prefix>` : ""}
</ListAllMyBucketsResult>`;
		else return `<?xml version="1.0" encoding="UTF-8"?>
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
	async createBucketHandler(options) {
		const { request, bucketName } = options;
		if (validateBucketName(bucketName) !== null) return new S3Error("InvalidBucketName", "The specified bucket is not valid.", 400, { bucketName });
		if (await this._metadataProvider.isBucketExist(bucketName) === true) return new S3Error("BucketAlreadyExists", "The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.", 409, { bucketName });
		const bucketData = await this._metadataProvider.createBucket(options);
		if (bucketData.errorCode) return new S3Error("InternalServerError", "An internal server error occurred.", bucketData.errorCode, { bucketName });
		this.buckets.set(bucketName, new this._objectSystemClass(bucketName, this._metadataProvider.getBucketMetadata(bucketName), this._objectSystemOptions));
	}
	async deleteBucketHandler(options) {
		const { request, bucketName } = options;
		if (!await this._metadataProvider.isBucketExist(bucketName)) return new S3Error("NoSuchBucket", "The specified bucket does not exist.", 404, { bucketName });
		const deleteData = await this._metadataProvider.deleteBucket(options);
		if (deleteData.errorCode) return new S3Error("InternalServerError", "An internal server error occurred.", deleteData.errorCode, { bucketName });
		this.buckets.delete(bucketName);
	}
	async getObjectSystem(bucketName) {
		if (!bucketName) return void 0;
		if (this.buckets.has(bucketName)) return this.buckets.get(bucketName);
		if (await this.isBucketExist(bucketName) === true) {
			const objectSystem = new this._objectSystemClass(bucketName, this._metadataProvider.getBucketMetadata(bucketName), this._objectSystemOptions);
			this.buckets.set(bucketName, objectSystem);
			return objectSystem;
		}
	}
	async copyObjectHandler(options) {
		const { bucketName, key, copySource, request } = options;
		const sourceMatch = copySource.match(/^\/?([^\/]+)\/(.+)$/);
		if (!sourceMatch) return new S3Error("InvalidArgument", "Copy source must be in the format /{bucket}/{key}", 400, { copySource });
		const [_, sourceBucketName, sourceKey] = sourceMatch;
		const sourceObjectSystem = await this.getObjectSystem(sourceBucketName);
		if (!sourceObjectSystem) return new S3Error("NoSuchBucket", "The specified source bucket does not exist.", 404, { bucketName: sourceBucketName });
		const targetObjectSystem = await this.getObjectSystem(bucketName);
		if (!targetObjectSystem) return new S3Error("NoSuchBucket", "The specified destination bucket does not exist.", 404, { bucketName });
		const headData = await sourceObjectSystem.headObjectHandler(sourceKey);
		if (headData.errorCode) return new S3Error("NoSuchKey", "The specified source key does not exist.", headData.errorCode, { key: sourceKey });
		const getData = await sourceObjectSystem.getObjectHandler(sourceKey, options.copySourceRange);
		if (getData.errorCode) return new S3Error("NoSuchKey", "The specified source key does not exist.", getData.errorCode, { key: sourceKey });
		if (!options.uploadId && getData.data) {
			const putData = await targetObjectSystem.putObjectHandler({
				key,
				data: getData.data
			});
			if (putData) return `<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <ETag>"${putData}"</ETag>
  <LastModified>${this._metadataProvider.normalizeDate(/* @__PURE__ */ new Date())}</LastModified>
</CopyObjectResult>`;
			else return new S3Error("InternalServerError", "An internal server error occurred.", 500, { key });
		} else {
			const uploadPartData = await targetObjectSystem.uploadPartHandler({
				key,
				partNumber: options.partNumber,
				uploadId: options.uploadId,
				data: getData.data
			});
			if (uploadPartData) return `<?xml version="1.0" encoding="UTF-8"?>
<CopyPartResult>
  <ETag>"${uploadPartData}"</ETag>
  <LastModified>${this._metadataProvider.normalizeDate(/* @__PURE__ */ new Date())}</LastModified>
</CopyPartResult>`;
			else return new S3Error("InternalServerError", "An internal server error occurred.", 500, { key });
		}
	}
};
//#endregion
//#region src/api/default/DefaultBucketSystem.ts
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
var DefaultBucketSystem = class extends BucketSystem {
	constructor(secretKey, _region, _metadataProviderClass = DefaultMetadataProvider, _metadataProviderOptions = { fileLocation: "./default_metadata.json" }, _objectSystemClass = DefaultObjectSystem, _objectSystemOptions = {}, _fileLocation = "./buckets.json", owner = {
		id: "",
		displayName: ""
	}) {
		super(secretKey, _region, _metadataProviderClass, _metadataProviderOptions, _objectSystemClass, _objectSystemOptions);
		this._fileLocation = _fileLocation;
		this.owner = owner;
		if (!existsSync(this._fileLocation)) writeFileSync(this._fileLocation, JSON.stringify({ buckets: [] }, null, 2));
	}
	async getOwner(request) {
		return this.owner;
	}
};
//#endregion
//#region src/api/S3Verifier.ts
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
var S3Verifier = class {
	static sha256(data) {
		return createHash("sha256").update(data).digest("hex");
	}
	static getSignatureKey(key, date, region, service) {
		return createHmac("sha256", createHmac("sha256", createHmac("sha256", createHmac("sha256", `AWS4${key}`).update(date).digest()).update(region).digest()).update(service).digest()).update("aws4_request").digest();
	}
	static parseAmzDate(s) {
		const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
		if (!m) return null;
		return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
	}
	static extractAPIKey(authHeader) {
		const match = authHeader.match(/Credential=([^,]+)/);
		return match ? match[1].split("/")[0] : null;
	}
	static async mutateRequest(req, secretKey) {
		const method = req.method || "GET";
		const url = new URL(req.url);
		const headers = Object.fromEntries(req.headers.entries());
		const query = Object.fromEntries(url.searchParams.entries());
		const bodyPromise = await req.arrayBuffer().then((buf) => Buffer.from(buf));
		return this.verify(method, url, headers, query, bodyPromise, secretKey);
	}
	static mutateRequestAsync(req, body, secretKey) {
		const method = req.method || "GET";
		const url = new URL(req.url);
		const headers = Object.fromEntries(req.headers.entries());
		const query = Object.fromEntries(url.searchParams.entries());
		return this.verify(method, url, headers, query, body, secretKey);
	}
	static verify(method, url, headers, query, body, secretKey) {
		const authHeader = headers["authorization"];
		const qSignature = query["X-Amz-Signature"] || query["x-amz-signature"];
		if (!authHeader && qSignature) return this.verifyPresigned(method, url, query, secretKey);
		if (!authHeader) return false;
		const match = authHeader.match(/Credential=([^,]+).*SignedHeaders=([^,]+).*Signature=([a-f0-9]+)/);
		if (!match) return false;
		const [, credentialScope, signedHeadersStr, providedSig] = match;
		const [, dateStamp, region, service] = credentialScope.split("/");
		const signedHeaders = signedHeadersStr.split(";");
		const reqTime = this.parseAmzDate(headers["x-amz-date"] ?? "");
		if (!reqTime || Math.abs(Date.now() - reqTime) > 900 * 1e3) return false;
		const canonicalHeaders = [...signedHeaders].sort().map((h) => `${h.toLowerCase()}:${(headers[h] ?? "").trim()}\n`).join("");
		const canonicalUri = url.pathname || "/";
		const canonicalQuery = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
		const payloadHash = headers["x-amz-content-sha256"] || this.sha256(body);
		const canonicalRequest = [
			method.toUpperCase(),
			canonicalUri,
			canonicalQuery,
			canonicalHeaders,
			signedHeadersStr,
			payloadHash
		].join("\n");
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			headers["x-amz-date"],
			`${dateStamp}/${region}/${service}/aws4_request`,
			this.sha256(canonicalRequest)
		].join("\n");
		const calculatedSig = createHmac("sha256", this.getSignatureKey(secretKey, dateStamp, region, service)).update(stringToSign).digest("hex");
		if (calculatedSig.length !== providedSig.length) return false;
		return timingSafeEqual(Buffer.from(calculatedSig), Buffer.from(providedSig));
	}
	static verifyPresigned(method, url, query, secretKey) {
		const getQueryParam = (key) => {
			const lowerKey = key.toLowerCase();
			for (const [k, v] of Object.entries(query)) if (k.toLowerCase() === lowerKey) return v;
			return null;
		};
		const algorithm = getQueryParam("x-amz-algorithm");
		const credential = getQueryParam("x-amz-credential");
		const amzDate = getQueryParam("x-amz-date");
		const expires = getQueryParam("x-amz-expires");
		const signedHeaders = getQueryParam("x-amz-signedheaders");
		const providedSig = getQueryParam("x-amz-signature");
		if (!algorithm || !credential || !amzDate || !expires || !signedHeaders || !providedSig) return false;
		if (algorithm !== "AWS4-HMAC-SHA256") return false;
		const credentialParts = credential.split("/");
		if (credentialParts.length !== 5) return false;
		const [accessKeyId, dateStamp, region, service, requestType] = credentialParts;
		if (!dateStamp || !region || !service || requestType !== "aws4_request") return false;
		const reqTime = this.parseAmzDate(amzDate);
		if (!reqTime) return false;
		const expiresSeconds = parseInt(expires, 10);
		if (isNaN(expiresSeconds) || expiresSeconds < 0 || expiresSeconds > 604800) return false;
		const expirationTime = reqTime + expiresSeconds * 1e3;
		if (Date.now() > expirationTime) return false;
		const rawQuery = url.search.substring(1);
		const params = [];
		for (const pair of rawQuery.split("&")) {
			const eqIndex = pair.indexOf("=");
			if (eqIndex === -1) continue;
			const key = pair.substring(0, eqIndex);
			const value = pair.substring(eqIndex + 1);
			if (key.toLowerCase() !== "x-amz-signature") params.push([key, value]);
		}
		params.sort(([a], [b]) => {
			if (a < b) return -1;
			if (a > b) return 1;
			return 0;
		});
		const queryParams = params.map(([k, v]) => `${k}=${v}`).join("&");
		const canonicalUri = url.pathname;
		const canonicalHeaders = signedHeaders.toLowerCase().split(";").sort().map((h) => `${h}:${url.host}\n`).join("");
		const canonicalRequest = [
			method.toUpperCase(),
			canonicalUri,
			queryParams,
			canonicalHeaders,
			signedHeaders.toLowerCase(),
			"UNSIGNED-PAYLOAD"
		].join("\n");
		const stringToSign = [
			"AWS4-HMAC-SHA256",
			amzDate,
			`${dateStamp}/${region}/${service}/aws4_request`,
			this.sha256(canonicalRequest)
		].join("\n");
		const calculatedSig = createHmac("sha256", this.getSignatureKey(secretKey, dateStamp, region, service)).update(stringToSign).digest("hex");
		if (calculatedSig.length !== providedSig.length) return false;
		return timingSafeEqual(Buffer.from(calculatedSig), Buffer.from(providedSig));
	}
	static verifyTime(headers, query) {
		headers = new Headers(headers);
		const amzDate = headers.get("x-amz-date") || query["x-amz-date"] || query["X-Amz-Date"] || "";
		const reqTime = this.parseAmzDate(amzDate);
		const now = /* @__PURE__ */ new Date();
		if (!reqTime) return false;
		return Math.abs(now.getTime() - reqTime) <= 900 * 1e3;
	}
};
//#endregion
//#region src/ElysiaS3Server.ts
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
function ElysiaS3Server$1({ elysiaOptions = {}, baseHost = [], iframeAllow = [], metadataProviderClass = DefaultMetadataProvider, metadataProviderOptions = { fileLocation: "./default_metadata.json" }, objectSystemClass = DefaultObjectSystem, objectSystemOptions = {}, owner = {
	id: "ASDSAFKNDKFJNSDV",
	displayName: "xTSK"
}, region = "us-east-1", bucketSystem = new DefaultBucketSystem(process.env.S3_SECRET_KEY || "A_KEY", region, metadataProviderClass, metadataProviderOptions, objectSystemClass, objectSystemOptions, "./buckets.json", owner) }) {
	return new Elysia({
		...elysiaOptions,
		name: "S3Server"
	}).all("/*", async ({ request }) => {
		return await new S3Server({
			baseHost,
			iframeAllow,
			metadataProviderClass,
			metadataProviderOptions,
			objectSystemClass,
			objectSystemOptions,
			owner,
			region,
			bucketSystem
		}).handleRequest(request);
	});
}
//#endregion
//#region src/index.ts
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
var S3Server = class {
	_baseHost;
	_iframeAllow;
	_metadataProviderClass;
	_metadataProviderOptions;
	_objectSystemClass;
	_objectSystemOptions;
	_bucketSystem;
	_owner;
	_region;
	_bucketSystems = /* @__PURE__ */ new Map();
	constructor({ baseHost = [], iframeAllow = [], metadataProviderClass = DefaultMetadataProvider, metadataProviderOptions = { fileLocation: "./default_metadata.json" }, objectSystemClass = DefaultObjectSystem, objectSystemOptions = {}, owner = {
		id: "ASDSAFKNDKFJNSDV",
		displayName: "xTSK"
	}, region = "us-east-1", bucketSystem = new DefaultBucketSystem(process.env.S3_SECRET_KEY || "A_KEY", region, metadataProviderClass, metadataProviderOptions, objectSystemClass, objectSystemOptions, "./buckets.json", owner) }) {
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
	getErrorResponse(status, errorCode, message, requestId) {
		return new Response(`<Error><Code>${errorCode}</Code><Message>${message}</Message></Error>`, {
			status,
			headers: {
				"x-amz-request-id": requestId || "",
				"content-security-policy": `frame-ancestors ${this._iframeAllow.join(" ") || "none"}`,
				"content-type": "application/xml"
			}
		});
	}
	getAccessDeniedResponse(requestId) {
		return new Response(this._bucketSystem.getAccessDeniedResponse(requestId), {
			status: 403,
			headers: {
				"x-amz-request-id": requestId,
				"content-security-policy": `frame-ancestors ${this._iframeAllow.join(" ") || "none"}`,
				"content-type": "application/xml"
			}
		});
	}
	getResponse(responseInit, body) {
		delete responseInit.internal;
		return new Response(body, {
			...responseInit,
			headers: { ...responseInit.headers }
		});
	}
	async authenticateRequest(request) {
		const requestId = crypto.randomUUID();
		const isValid = await S3Verifier.mutateRequest(request, this._bucketSystem.getSecretKey(request));
		const isTimeValid = S3Verifier.verifyTime(request.headers, Object.fromEntries(new URL(request.url).searchParams.entries()));
		if (!isValid || !isTimeValid) return this.getAccessDeniedResponse(requestId);
		return { headers: {
			"x-amz-request-id": requestId,
			"content-security-policy": `frame-ancestors 'self' ${this._iframeAllow.join(" ") || "none"}`
		} };
	}
	async extractBucketName(request, response) {
		const url = new URL(request.url);
		let host = url.host;
		for (const base of this._baseHost) if (host.endsWith(base)) {
			host = host.slice(0, host.length - base.length);
			break;
		}
		const vhostMatch = host.match(/^([a-z0-9.-]+)\./);
		let bucket = null;
		if (vhostMatch && !url.pathname.startsWith("/")) bucket = vhostMatch[1];
		else {
			const pathParts = url.pathname.split("/").filter(Boolean);
			if (pathParts.length > 0) bucket = pathParts[0];
		}
		return {
			...response,
			internal: {
				bucket: bucket || "",
				owner: await this._bucketSystem.getOwner(request),
				isRootRequest: url.pathname === "/",
				isVirtualHostedStyle: !!vhostMatch
			}
		};
	}
	async handleRequest(request) {
		const authResult = await this.authenticateRequest(request);
		if (authResult instanceof Response) return authResult;
		const bucketInfo = await this.extractBucketName(request, authResult);
		if (bucketInfo instanceof Response) return bucketInfo;
		const url = new URL(request.url);
		const query = Object.fromEntries(url.searchParams.entries());
		const headers = Object.fromEntries(request.headers.entries());
		switch (request.method) {
			case "GET": return this.handleGet(request, bucketInfo, query, headers);
			case "HEAD": return this.handleHead(request, bucketInfo);
			case "PUT": return this.handlePut(request, bucketInfo, query, headers);
			case "DELETE": return this.handleDelete(request, bucketInfo, query, headers);
			case "POST": return this.handlePost(request, bucketInfo, query, headers);
			default: return new Response("Method Not Allowed", { status: 405 });
		}
	}
	async handleGet(request, responseInit, query, headers) {
		/**
		* List Buckets: GET / with no bucket specified
		*/
		if (responseInit.internal?.isRootRequest) {
			const bucketXml = await this._bucketSystem.listsBucketsHandler({
				request,
				prefix: query.prefix,
				maxBuckets: query["max-keys"] ? parseInt(query["max-keys"].toString()) : void 0,
				continuationToken: query["continuation-token"]
			});
			responseInit.headers["content-type"] = "application/xml";
			return this.getResponse(responseInit, bucketXml);
		}
		const bucket = responseInit.internal?.bucket;
		if (!bucket) return this.getErrorResponse(404, "BucketNotFound", "Bad Request: Bucket name could not be determined");
		let path = responseInit.internal?.isVirtualHostedStyle ? request.url.replace(/^https?:\/\/[^/]+/, "") : new URL(request.url).pathname.replace(new RegExp(`^(\/|)${bucket}`), "");
		path = "/" + path.replace(/^\/+/, "");
		let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
		if (!objectSystem) return this.getErrorResponse(404, "BucketNotFound", `Bucket "${bucket}" not found`);
		/**
		* List Objects V2: GET /bucket?list-type=2
		*/
		if (path === "/") {
			const { "list-type": listType, prefix, delimiter, "fetch-owner": fetchOwner, "max-keys": maxKeys, "continuation-token": continuationToken, "start-after": startAfter, "encoding-type": encodingType, "expected-bucket-owner": expectedBucketOwner } = query;
			const listObjectsXml = await objectSystem.listObjectsV2Handler({
				listType,
				prefix,
				delimiter,
				fetchOwner: fetchOwner === "true",
				maxKeys: maxKeys ? parseInt(maxKeys.toString()) : void 0,
				continuationToken,
				startAfter,
				encodingType,
				expectedBucketOwner
			});
			responseInit.headers["content-type"] = "application/xml";
			console.log(this.getResponse(responseInit, listObjectsXml));
			return this.getResponse(responseInit, listObjectsXml);
		}
		/**
		* Get Object: GET /bucket/key
		*/
		const range = headers.Range || headers.range;
		path = decodeURIComponent(path);
		path = "/" + path.replace(/^\/+/, "");
		const objectMetadata = await objectSystem.getObject(decodeURIComponent(path), range);
		if (objectMetadata.errorCode) return this.getErrorResponse(objectMetadata.httpStatus || 404, objectMetadata.error || "ObjectNotFound", `Object "${path}" not found in bucket "${bucket}"`);
		responseInit.headers["content-length"] = objectMetadata.contentLength?.toString() || "0";
		responseInit.headers["last-modified"] = objectMetadata.lastModified ? new Date(objectMetadata.lastModified).toUTCString() : (/* @__PURE__ */ new Date()).toUTCString();
		if (objectMetadata.eTag) responseInit.headers["etag"] = `"${objectMetadata.eTag}"`;
		if (range) responseInit.headers["accept-ranges"] = "bytes";
		if (objectMetadata.contentType) responseInit.headers["content-type"] = objectMetadata.contentType || "application/octet-stream";
		if (objectMetadata.data) return this.getResponse(responseInit, Readable.toWeb(Readable.from(objectMetadata.data)));
		else return this.getResponse(responseInit, void 0);
	}
	async handleHead(request, responseInit) {
		const bucket = responseInit.internal?.bucket;
		if (!bucket) return this.getErrorResponse(404, "BucketNotFound", "Bad Request: Bucket name could not be determined");
		let path = responseInit.internal?.isVirtualHostedStyle ? request.url.replace(/^https?:\/\/[^/]+/, "") : new URL(request.url).pathname.replace(new RegExp(`^(\/|)${bucket}`), "");
		path = "/" + path.replace(/^\/+/, "");
		let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
		if (!objectSystem) return this.getErrorResponse(404, "BucketNotFound", `Bucket "${bucket}" not found`);
		/**
		* Head Bucket: HEAD /bucket
		*/
		if (path === "/") {
			const isExists = await this._bucketSystem.isBucketExist(bucket, this._owner, true);
			if (typeof isExists === "boolean") {
				if (isExists) responseInit.status = 200;
				else responseInit.status = 404;
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
		const objectMetadata = await objectSystem.headObject(decodeURIComponent(path));
		if (objectMetadata.errorCode) return this.getErrorResponse(objectMetadata.httpStatus || 404, objectMetadata.error || "ObjectNotFound", `Object "${path}" not found in bucket "${bucket}"`);
		responseInit.headers["content-length"] = objectMetadata.contentLength?.toString() || "0";
		responseInit.headers["last-modified"] = objectMetadata.lastModified ? new Date(objectMetadata.lastModified).toUTCString() : (/* @__PURE__ */ new Date()).toUTCString();
		if (objectMetadata.eTag) responseInit.headers["etag"] = `"${objectMetadata.eTag}"`;
		if (objectMetadata.contentType) responseInit.headers["content-type"] = objectMetadata.contentType || "application/octet-stream";
		return this.getResponse(responseInit, void 0);
	}
	async handlePut(request, responseInit, query, headers) {
		const bucket = responseInit.internal?.bucket;
		if (!bucket) return this.getErrorResponse(404, "BucketNotFound", "Bad Request: Bucket name could not be determined");
		let path = responseInit.internal?.isVirtualHostedStyle ? request.url.replace(/^https?:\/\/[^/]+/, "") : new URL(request.url).pathname.replace(new RegExp(`^(\/|)${bucket}`), "");
		path = "/" + path.replace(/^\/+/, "");
		/**
		* Create Bucket: PUT /bucket
		*/
		if (path.split("/").filter(Boolean).length === 0) {
			const newBucketError = await this._bucketSystem.createBucketHandler({
				bucketName: bucket || `bucket-${crypto.randomUUID()}`,
				request
			});
			if (newBucketError) {
				responseInit.status = newBucketError.httpStatus || 500;
				return this.getErrorResponse(newBucketError.httpStatus || 500, newBucketError.code || "InternalServerError", newBucketError.message || "An error occurred while creating the bucket");
			}
			responseInit.headers["content-length"] = "0";
			responseInit.headers.connection = "close";
			responseInit.headers.location = `${responseInit.internal?.isVirtualHostedStyle ? "/" : `/${bucket}`}`;
			return this.getResponse(responseInit, void 0);
		}
		let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
		if (!objectSystem) return this.getErrorResponse(404, "BucketNotFound", `Bucket "${bucket}" not found`);
		path = decodeURIComponent(path);
		path = "/" + path.replace(/^\/+/, "");
		const { "x-amz-copy-source": copySource, "x-amz-metadata-directive": metadataDirective, "x-amz-copy-source-range": copySourceRange } = headers;
		const { partNumber, uploadId } = query;
		/**
		* Copy Object: PUT /bucket/key with x-amz-copy-source header
		*/
		if (copySource) {
			const [sourceBucket, ...sourceKeyParts] = copySource.split("/").filter(Boolean);
			const sourceObjectSystem = await this._bucketSystem.getObjectSystem(sourceBucket);
			if (!sourceObjectSystem) {
				responseInit.status = 404;
				return this.getErrorResponse(404, "BucketNotFound", `Source bucket "${sourceBucket}" not found`);
			}
			const copyItem = await sourceObjectSystem.getObjectHandler(sourceKeyParts.join("/"));
			if (copyItem.errorCode) {
				responseInit.status = copyItem.httpStatus || 404;
				return this.getErrorResponse(copyItem.httpStatus || 404, copyItem.error || "ObjectNotFound", `Source object "${sourceKeyParts.join("/")}" not found in bucket "${sourceBucket}"`);
			}
			if (!bucket) {
				responseInit.status = 404;
				return this.getErrorResponse(404, "BucketNotFound", "Destination bucket could not be determined");
			}
			const copyResult = await this._bucketSystem.copyObjectHandler({
				bucketName: bucket,
				key: path,
				copySource,
				copySourceRange,
				uploadId,
				partNumber: partNumber ? Number(partNumber) : void 0,
				request
			});
			if (copyResult instanceof S3Error) {
				responseInit.status = copyResult.httpStatus || 500;
				return this.getErrorResponse(copyResult.httpStatus || 500, copyResult.code || "InternalServerError", copyResult.message || "An error occurred while copying the object");
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
				data: partBuffer
			});
			responseInit.headers["ETag"] = `"${partMD5}"`;
			return this.getResponse(responseInit, partMD5);
		}
		/**
		* Put Object: PUT /bucket/key with body
		*/
		const bodyBuf = body ? Buffer.from(body) : void 0;
		const md5Checksum = await objectSystem.putObjectHandler({
			key: path,
			data: bodyBuf
		});
		responseInit.headers["content-length"] = "0";
		responseInit.headers.connection = "close";
		responseInit.headers["ETag"] = `"${md5Checksum}"`;
		return this.getResponse(responseInit, void 0);
	}
	async handlePost(request, responseInit, query, headers) {
		const bucket = responseInit.internal?.bucket;
		if (!bucket) return this.getErrorResponse(404, "BucketNotFound", "Bad Request: Bucket name could not be determined");
		let path = responseInit.internal?.isVirtualHostedStyle ? request.url.replace(/^https?:\/\/[^/]+/, "") : new URL(request.url).pathname.replace(new RegExp(`^(\/|)${bucket}`), "");
		path = "/" + path.replace(/^\/+/, "");
		let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
		if (!objectSystem) return this.getErrorResponse(404, "BucketNotFound", `Bucket "${bucket}" not found`);
		path = decodeURIComponent(path);
		path = "/" + path.replace(/^\/+/, "");
		const { delete: deleteAction, uploads: uploadsAction, uploadId } = query;
		const contentType = headers["Content-Type"] || headers["content-type"] || "application/octet-stream";
		/**
		* Delete Multiple Objects: POST /bucket?delete with XML body specifying keys to delete
		*/
		if (deleteAction === "") {
			const keysToDelete = [...(await request.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => decodeURIComponent(match[1]));
			await objectSystem.deleteObjects(keysToDelete).catch((err) => {
				console.error(`Error deleting objects`, keysToDelete, err);
				const errorResponse = new S3Error("DeleteError", "Error deleting objects");
				responseInit.status = errorResponse.httpStatus || 500;
				return errorResponse.toXML();
			});
			return this.getResponse(responseInit, `<?xml version="1.0" encoding="UTF-8"?>
       <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         ${keysToDelete.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join("")}
       </DeleteResult>`);
		}
		/**
		* Multipart Upload (Initiate/Complete): POST /bucket/key?uploads to initiate, then PUT /bucket/key?partNumber=1&uploadId=abc123 for each part, and finally POST /bucket/key?uploadId=abc123 with XML body specifying parts to complete
		*/
		if (uploadsAction === "") {
			const createMultipartXml = await objectSystem.createMultipartUploadHandler({
				key: path,
				contentType
			});
			return this.getResponse(responseInit, createMultipartXml);
		}
		/**
		* Complete Multipart Upload: POST /bucket/key?uploadId=abc123 with XML body specifying parts to complete
		*/
		if (uploadId) {
			const parts = [...(await request.text()).matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>"?([^"<]+)"?<\/ETag><\/Part>/g)].map((match) => ({
				partNumber: Number(match[1]),
				eTag: match[2]
			}));
			const combinedData = await objectSystem.completeMultipartUploadHandler({
				url: request.url,
				key: path,
				uploadId,
				parts
			});
			return this.getResponse(responseInit, combinedData);
		}
		return new Response("Not Implemented", { status: 501 });
	}
	async handleDelete(request, responseInit, query, headers) {
		const bucket = responseInit.internal?.bucket;
		if (!bucket) return this.getErrorResponse(404, "BucketNotFound", "Bad Request: Bucket name could not be determined");
		let path = responseInit.internal?.isVirtualHostedStyle ? request.url.replace(/^https?:\/\/[^/]+/, "") : new URL(request.url).pathname.replace(new RegExp(`^(\/|)${bucket}`), "");
		path = "/" + path.replace(/^\/+/, "");
		/**
		* Delete Bucket: DELETE /bucket
		*/
		if (path === "/") {
			const deleteBucketError = await this._bucketSystem.deleteBucketHandler({
				bucketName: bucket || `bucket-${crypto.randomUUID()}`,
				request
			});
			if (deleteBucketError) {
				responseInit.status = deleteBucketError.httpStatus || 500;
				return this.getResponse(responseInit, deleteBucketError.toXML());
			}
			responseInit.status = 204;
			return this.getResponse(responseInit, void 0);
		}
		let objectSystem = await this._bucketSystem.getObjectSystem(bucket);
		if (!objectSystem) return this.getErrorResponse(404, "BucketNotFound", `Bucket "${bucket}" not found`);
		const { uploadId } = query;
		/**
		* Abort Multipart Upload: DELETE /bucket/key?uploadId=abc123
		*/
		if (uploadId) {
			await objectSystem.abortMultipartUpload({
				key: `/${path}`,
				uploadId
			});
			responseInit.status = 204;
			responseInit.headers.connection = "keep-alive";
			responseInit.headers["content-length"] = 0;
			return this.getResponse(responseInit, void 0);
		}
		/**
		* Delete Object: DELETE /bucket/key
		*/
		path = decodeURIComponent(path);
		await objectSystem.deleteObjectHandler({ key: path });
		responseInit.status = 204;
		return this.getResponse(responseInit, void 0);
	}
};
const ElysiaS3Server = ElysiaS3Server$1;
//#endregion
export { ElysiaS3Server, S3Server as default };
