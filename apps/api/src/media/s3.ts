/**
 * S3-compatible adapter (production). Signs each request with AWS Signature Version 4 using Node's
 * crypto, so no SDK is needed; tested against the AWS-published signing example and a local fake
 * S3 server. Path-style addressing (`endpoint/bucket/key`) by default, which every S3-compatible
 * store supports; virtual-hosted style with DP_S3_FORCE_PATH_STYLE=false.
 *
 * The credentials come from the environment, are held only here and never logged or returned.
 * Objects are written without any ACL header: buckets stay private.
 */
import { createHash, createHmac } from "node:crypto";
import {
  assertKey,
  MediaStorageError,
  STRAY_PATTERN,
  type MediaStorage,
  type StoredObject,
} from "./storage.js";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it (keeps unreserved characters; slashes optional). */
export function uriEncode(value: string, keepSlash: boolean): string {
  return Array.from(value)
    .map((ch) => {
      if (/[A-Za-z0-9_.~-]/.test(ch) || (keepSlash && ch === "/")) return ch;
      return Array.from(Buffer.from(ch, "utf8"))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    })
    .join("");
}

export interface SignInput {
  method: string;
  host: string;
  path: string; // already URI-encoded
  query?: string; // canonical query string
  headers: Record<string, string>; // lower-case names, besides host
  payloadHash: string;
  amzDate: string; // YYYYMMDD'T'HHMMSS'Z'
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  service?: string;
}

/** The Authorization header value of a SigV4 request. */
export function signV4(input: SignInput): string {
  const service = input.service ?? "s3";
  const date = input.amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: input.host, ...input.headers };
  const names = Object.keys(headers)
    .map((n) => n.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${String(headers[n]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const TIMEOUT_MS = 15_000;

export class S3Storage implements MediaStorage {
  readonly kind = "s3" as const;
  private readonly base: URL;

  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.base = new URL(config.endpoint);
    if (
      this.base.protocol !== "https:" &&
      !/^(localhost|127\.0\.0\.1|minio|s3)$/.test(this.base.hostname)
    ) {
      throw new MediaStorageError("DP_S3_ENDPOINT must use https");
    }
  }

  private target(key: string): { url: string; host: string; path: string } {
    const k = uriEncode(assertKey(key), true);
    const bucket = uriEncode(this.config.bucket, false);
    if (this.config.forcePathStyle) {
      const prefix = this.base.pathname.replace(/\/$/, "");
      const p = `${prefix}/${bucket}/${k}`;
      return { url: `${this.base.origin}${p}`, host: this.base.host, path: p };
    }
    const host = `${bucket}.${this.base.host}`;
    return { url: `${this.base.protocol}//${host}/${k}`, host, path: `/${k}` };
  }

  /** The bucket itself (ListObjectsV2). */
  private bucketTarget(): { url: string; host: string; path: string } {
    const bucket = uriEncode(this.config.bucket, false);
    if (this.config.forcePathStyle) {
      const prefix = this.base.pathname.replace(/\/$/, "");
      const p = `${prefix}/${bucket}`;
      return { url: `${this.base.origin}${p}`, host: this.base.host, path: p };
    }
    const host = `${bucket}.${this.base.host}`;
    return { url: `${this.base.protocol}//${host}/`, host, path: "/" };
  }

  private async send(
    method: string,
    key: string | null,
    body?: Buffer,
    contentType?: string,
    query?: Record<string, string>,
  ) {
    const t = key === null ? this.bucketTarget() : this.target(key);
    const { host, path } = t;
    // Canonical query: names and values encoded, sorted by name (SigV4).
    const canonicalQuery = Object.entries(query ?? {})
      .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const url = canonicalQuery ? `${t.url}?${canonicalQuery}` : t.url;
    const amzDate = this.now()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const payloadHash = sha256Hex(body ?? "");
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    const authorization = signV4({
      method,
      host,
      path,
      headers,
      payloadHash,
      amzDate,
      ...(canonicalQuery ? { query: canonicalQuery } : {}),
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
    });
    try {
      return await this.fetchImpl(url, {
        method,
        headers: { ...headers, authorization },
        ...(body ? { body: new Uint8Array(body) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MediaStorageError(`s3 ${method} unreachable`);
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, data, contentType);
    await res.arrayBuffer().catch(() => undefined);
    if (res.status !== 200) throw new MediaStorageError(`s3 PUT failed (${res.status})`);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (res.status !== 200) throw new MediaStorageError(`s3 GET failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    await res.arrayBuffer().catch(() => undefined);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      throw new MediaStorageError(`s3 DELETE failed (${res.status})`);
    }
  }

  /** ListObjectsV2 under products/, page by page (at most 1000 keys per request). */
  async *list(): AsyncIterable<StoredObject> {
    let token: string | null = null;
    for (let page = 0; page < 100_000; page++) {
      const query: Record<string, string> = { "list-type": "2", prefix: "products/" };
      if (token) query["continuation-token"] = token;
      const res = await this.send("GET", null, undefined, undefined, query);
      const xml = await res.text().catch(() => "");
      if (res.status !== 200) throw new MediaStorageError(`s3 LIST failed (${res.status})`);
      yield* parseListObjects(xml);
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = truncated
        ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null)
        : null;
      if (!token) return;
      token = decodeXml(token);
    }
  }

  /** S3 writes are atomic: there are no temporary objects. Refuses anything but a stray name. */
  async deleteStray(name: string): Promise<void> {
    if (!STRAY_PATTERN.test(name)) throw new MediaStorageError("invalid stray name");
    return Promise.resolve();
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The <Contents> entries of a ListObjectsV2 answer (only Key, Size and LastModified). */
export function parseListObjects(xml: string): StoredObject[] {
  const out: StoredObject[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = m[1] ?? "";
    const key = /<Key>([^<]*)<\/Key>/.exec(body)?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? "0");
    const modified = /<LastModified>([^<]+)<\/LastModified>/.exec(body)?.[1];
    if (!key) continue;
    out.push({
      key: decodeXml(key),
      size,
      lastModified: modified ? new Date(modified) : new Date(0),
    });
  }
  return out;
}
