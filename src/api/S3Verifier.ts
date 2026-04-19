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
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export class S3Verifier {
  static sha256(data: string | Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }

  static getSignatureKey(
    key: string,
    date: string,
    region: string,
    service: string,
  ): Buffer {
    const kDate = createHmac("sha256", `AWS4${key}`).update(date).digest();
    const kRegion = createHmac("sha256", kDate).update(region).digest();
    const kService = createHmac("sha256", kRegion).update(service).digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }

  static parseAmzDate(s: string): number | null {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  static extractAPIKey(authHeader: string): string | null {
    const match = authHeader.match(/Credential=([^,]+)/);
    return match ? match[1].split("/")[0] : null;
  }

  static async mutateRequest(
    req: Request,
    secretKey: string,
  ): Promise<boolean> {
    const method = req.method || "GET";
    const url = new URL(req.url);
    const headers: Record<string, string> = Object.fromEntries(
      req.headers.entries(),
    );
    const query: Record<string, string> = Object.fromEntries(
      url.searchParams.entries(),
    );
    const bodyPromise = await req.arrayBuffer().then((buf) => Buffer.from(buf));

    return this.verify(method, url, headers, query, bodyPromise, secretKey);
  }

  static mutateRequestAsync(
    req: Request,
    body: Buffer,
    secretKey: string,
  ): boolean {
    const method = req.method || "GET";
    const url = new URL(req.url);
    const headers: Record<string, string> = Object.fromEntries(
      req.headers.entries(),
    );
    const query: Record<string, string> = Object.fromEntries(
      url.searchParams.entries(),
    );

    return this.verify(method, url, headers, query, body, secretKey);
  }

  static verify(
    method: string,
    url: URL,
    headers: Record<string, string>,
    query: Record<string, string>,
    body: Buffer,
    secretKey: string,
  ): boolean {
    const authHeader = headers["authorization"];
    const qSignature = query["X-Amz-Signature"] || query["x-amz-signature"];

    // If no auth header but has query signature, verify as presigned URL
    if (!authHeader && qSignature) {
      return this.verifyPresigned(method, url, query, secretKey);
    }

    if (!authHeader) return false;

    const match = authHeader.match(
      /Credential=([^,]+).*SignedHeaders=([^,]+).*Signature=([a-f0-9]+)/,
    );
    if (!match) return false;

    const [, credentialScope, signedHeadersStr, providedSig] = match;
    const [, dateStamp, region, service] = credentialScope.split("/");
    const signedHeaders = signedHeadersStr.split(";");

    // Clock skew check
    const reqTime = this.parseAmzDate(headers["x-amz-date"] ?? "");
    if (!reqTime || Math.abs(Date.now() - reqTime) > 15 * 60 * 1000)
      return false;

    // Canonical request
    const canonicalHeaders = [...signedHeaders]
      .sort()
      .map((h) => `${h.toLowerCase()}:${(headers[h] ?? "").trim()}\n`)
      .join("");
    const canonicalUri = url.pathname || "/";
    const canonicalQuery = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const payloadHash = headers["x-amz-content-sha256"] || this.sha256(body);

    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeadersStr,
      payloadHash,
    ].join("\n");

    // String to sign
    const amzDate = headers["x-amz-date"];
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      `${dateStamp}/${region}/${service}/aws4_request`,
      this.sha256(canonicalRequest),
    ].join("\n");

    // Derive key and compare
    const signingKey = this.getSignatureKey(
      secretKey,
      dateStamp,
      region,
      service,
    );
    const calculatedSig = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    if (calculatedSig.length !== providedSig.length) return false;
    return timingSafeEqual(
      Buffer.from(calculatedSig),
      Buffer.from(providedSig),
    );
  }

  static verifyPresigned(
    method: string,
    url: URL,
    query: Record<string, string>,
    secretKey: string,
  ): boolean {
    // Extract required parameters from query string (case-insensitive)
    const getQueryParam = (key: string) => {
      const lowerKey = key.toLowerCase();
      for (const [k, v] of Object.entries(query)) {
        if (k.toLowerCase() === lowerKey) return v;
      }
      return null;
    };

    const algorithm = getQueryParam("x-amz-algorithm");
    const credential = getQueryParam("x-amz-credential");
    const amzDate = getQueryParam("x-amz-date");
    const expires = getQueryParam("x-amz-expires");
    const signedHeaders = getQueryParam("x-amz-signedheaders");
    const providedSig = getQueryParam("x-amz-signature");

    if (
      !algorithm ||
      !credential ||
      !amzDate ||
      !expires ||
      !signedHeaders ||
      !providedSig
    ) {
      return false;
    }

    if (algorithm !== "AWS4-HMAC-SHA256") return false;

    // Parse credential scope
    const credentialParts = credential.split("/");
    if (credentialParts.length !== 5) return false;

    const [accessKeyId, dateStamp, region, service, requestType] =
      credentialParts;
    if (!dateStamp || !region || !service || requestType !== "aws4_request")
      return false;

    // Check expiration
    const reqTime = this.parseAmzDate(amzDate);
    if (!reqTime) return false;

    const expiresSeconds = parseInt(expires, 10);
    if (
      isNaN(expiresSeconds) ||
      expiresSeconds < 0 ||
      expiresSeconds > 604800
    ) {
      return false; // Max 7 days
    }

    const expirationTime = reqTime + expiresSeconds * 1000;
    if (Date.now() > expirationTime) return false;

    // Build canonical query string using RAW query string from URL
    // Parse the raw query string to preserve exact encoding
    const rawQuery = url.search.substring(1); // Remove leading '?'
    const params: Array<[string, string]> = [];

    for (const pair of rawQuery.split("&")) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) continue;

      const key = pair.substring(0, eqIndex);
      const value = pair.substring(eqIndex + 1);

      // Skip the signature parameter
      if (key.toLowerCase() !== "x-amz-signature") {
        params.push([key, value]);
      }
    }

    // Sort by key name (byte-wise, case-sensitive)
    params.sort(([a], [b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    // Reconstruct canonical query string with exact encoding from URL
    const queryParams = params.map(([k, v]) => `${k}=${v}`).join("&");

    // Canonical URI - must be URL encoded
    // const canonicalUri = encodeURI(url.pathname || "/").replace(/%2F/g, "/");
    const canonicalUri = url.pathname;

    // Canonical headers - for presigned URLs, typically only 'host' is signed
    const headersList = signedHeaders.toLowerCase().split(";").sort();
    const canonicalHeaders = headersList
      .map((h) => `${h}:${url.host}\n`)
      .join("");

    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      queryParams,
      canonicalHeaders,
      signedHeaders.toLowerCase(),
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    // String to sign
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      `${dateStamp}/${region}/${service}/aws4_request`,
      this.sha256(canonicalRequest),
    ].join("\n");

    // Derive signing key and calculate signature
    const signingKey = this.getSignatureKey(
      secretKey,
      dateStamp,
      region,
      service,
    );
    const calculatedSig = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    if (calculatedSig.length !== providedSig.length) return false;
    return timingSafeEqual(
      Buffer.from(calculatedSig),
      Buffer.from(providedSig),
    );
  }

  static verifyTime(
    headers: Headers | Record<string, string>,
    query: Record<string, string>,
  ): boolean {
    headers = new Headers(headers);
    const amzDate =
      headers.get("x-amz-date") ||
      query["x-amz-date"] ||
      query["X-Amz-Date"] ||
      "";
    const reqTime = this.parseAmzDate(amzDate);
    const now = new Date();
    if (!reqTime) return false;
    return Math.abs(now.getTime() - reqTime) <= 15 * 60 * 1000;
  }
}
