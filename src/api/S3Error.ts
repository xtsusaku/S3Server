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
export class S3Error extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly requestId: string;
  public readonly hostId: string;
  public readonly bucketName?: string;
  public readonly key?: string;

  constructor(
    code: string,
    message: string,
    httpStatus: number = 500,
    options?: {
      bucketName?: string;
      key?: string;
      hostId?: string;
      copySource?: string;
    },
  ) {
    super(message);
    this.name = "S3Error";
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId =
      globalThis.crypto?.randomUUID?.() ??
      `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.hostId = options?.hostId || "s3-clone-host";
    this.bucketName = options?.bucketName;
    this.key = options?.key;

    // Preserve prototype chain for `instanceof` checks
    Object.setPrototypeOf(this, S3Error.prototype);
  }

  /** Minimal XML serializer matching AWS S3 error format */
  toXML(): string {
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error>\n`;
    xml += `  <Code>${esc(this.code)}</Code>\n`;
    xml += `  <Message>${esc(this.message)}</Message>\n`;
    if (this.bucketName)
      xml += `  <BucketName>${esc(this.bucketName)}</BucketName>\n`;
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
      stack: process.env.NODE_ENV === "development" ? this.stack : undefined,
    };
  }
}
