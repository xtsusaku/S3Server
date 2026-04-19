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

export function validateBucketName(name: string): string | null {
  if (!name) return "BucketNameTooShort";
  if (name.length < 3) return "BucketNameTooShort";
  if (name.length > 63) return "BucketNameTooLong";
  if (!BUCKET_NAME_RE.test(name)) return "InvalidBucketName";
  if (name.includes("..")) return "InvalidBucketName";
  if (name.startsWith("xn--")) return "InvalidBucketName";
  if (name.endsWith("-s3alias")) return "InvalidBucketName";
  // IP address check: 192.168.0.1 etc.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "InvalidBucketName";
  return null; // valid
}
