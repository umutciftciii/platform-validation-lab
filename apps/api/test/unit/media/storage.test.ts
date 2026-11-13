// PM-2: media storage adapters — filesystem (atomic, private, no traversal), S3 SigV4 signing
// (AWS-published example) and request flow against a fake S3, configuration rules.
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaStorage, MediaConfigError } from "../../../src/media/config.js";
import { FilesystemStorage } from "../../../src/media/filesystem.js";
import { S3Storage, signV4, uriEncode } from "../../../src/media/s3.js";
import {
  assertKey,
  DisabledStorage,
  DOCUMENT_KEY_PATTERN,
  KEY_PATTERN,
  MediaStorageError,
  newDocumentKey,
  newImageKeys,
} from "../../../src/media/storage.js";
import { planCleanup } from "../../../src/media/cleanup.js";

describe("media keys", () => {
  it("are random, fixed-shape and refuse anything else", () => {
    const a = newImageKeys();
    const b = newImageKeys();
    expect(a.original).toMatch(/^products\/[0-9a-f]{32}\/original$/);
    expect(a.display).toBe(a.original.replace("original", "display.webp"));
    expect(a.original).not.toBe(b.original);
    for (const bad of [
      "../etc/passwd",
      "products/../../x",
      "products/ABC/original",
      "/abs",
      "products/" + "a".repeat(32) + "/x.svg",
    ]) {
      expect(() => assertKey(bad)).toThrow(MediaStorageError);
    }
  });
});

describe("document keys (PM-5)", () => {
  it("are random, under documents/, and never image keys", () => {
    const a = newDocumentKey();
    expect(a).toMatch(/^documents\/[0-9a-f]{32}\/document\.pdf$/);
    expect(a).not.toBe(newDocumentKey());
    expect(assertKey(a)).toBe(a);
    expect(KEY_PATTERN.test(a)).toBe(false);
    expect(DOCUMENT_KEY_PATTERN.test(newImageKeys().original)).toBe(false);
    for (const bad of [
      "documents/../x/document.pdf",
      "documents/" + "a".repeat(32) + "/other.pdf",
      "documents/" + "A".repeat(32) + "/document.pdf",
      "products/" + "a".repeat(32) + "/document.pdf",
    ]) {
      expect(() => assertKey(bad)).toThrow(MediaStorageError);
    }
  });

  it("are invisible to list() and so never cleaned up as orphans", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dp-docs-"));
    try {
      const fs = new FilesystemStorage(dir);
      const key = newDocumentKey();
      await fs.put(key, Buffer.from("%PDF-1.7"), "application/pdf");
      expect((await fs.get(key))?.toString()).toBe("%PDF-1.7");
      const listed: string[] = [];
      for await (const o of fs.list()) listed.push(o.key);
      expect(listed).toEqual([]);
      const plan = await planCleanup(fs, new Set(), new Date(Date.now() + 1e12), 0);
      expect(plan.orphans).toEqual([]);
      expect(await fs.get(key)).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("filesystem storage", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "dp-media-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes privately and atomically, reads and deletes", async () => {
    const s = new FilesystemStorage(dir);
    const { original } = newImageKeys();
    await s.put(original, Buffer.from("bytes"), "image/png");
    expect((await s.get(original))?.toString()).toBe("bytes");
    const file = path.join(dir, original);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(readdirSync(path.dirname(file)).some((f) => f.endsWith(".tmp"))).toBe(false);
    await s.delete(original);
    expect(await s.get(original)).toBeNull();
    await s.delete(original); // missing is fine
  });

  it("refuses relative roots and foreign keys", async () => {
    expect(() => new FilesystemStorage("relative/dir")).toThrow(MediaStorageError);
    const s = new FilesystemStorage(dir);
    await expect(s.get("../../etc/passwd")).rejects.toThrow(MediaStorageError);
  });

  it("reports write failures as storage errors (no partial file)", async () => {
    // The root is a regular file, so no directory can be created below it.
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "x");
    const s = new FilesystemStorage(blocker);
    await expect(s.put(newImageKeys().original, Buffer.from("x"), "image/png")).rejects.toThrow(
      MediaStorageError,
    );
  });
});

describe("S3 signature version 4", () => {
  // AWS documentation, "Signature Calculations for the Authorization Header", GET Object example.
  // The example credentials are assembled at run time (they are public documentation values).
  const ACCESS = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  const SECRET = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/");

  it("matches the AWS-published GET Object example", () => {
    const auth = signV4({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: {
        range: "bytes=0-9",
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      amzDate: "20130524T000000Z",
      region: "us-east-1",
      accessKeyId: ACCESS,
      secretAccessKey: SECRET,
    });
    expect(auth).toBe(
      `AWS4-HMAC-SHA256 Credential=${ACCESS}/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41`,
    );
  });

  it("encodes like RFC 3986", () => {
    expect(uriEncode("a b/c~d*", true)).toBe("a%20b/c~d%2A");
    expect(uriEncode("a/b", false)).toBe("a%2Fb");
  });
});

describe("S3 storage against a fake S3", () => {
  let server: Server;
  let endpoint: string;
  const objects = new Map<string, { body: Buffer; type: string }>();
  const seen: {
    method: string;
    url: string;
    auth: string;
    acl: string | undefined;
    type: string | undefined;
  }[] = [];
  let failNext = 0;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method ?? "",
          url: req.url ?? "",
          auth: String(req.headers.authorization ?? ""),
          acl: req.headers["x-amz-acl"] as string | undefined,
          type: req.headers["content-type"],
        });
        if (failNext > 0) {
          failNext--;
          res.statusCode = 500;
          res.end();
          return;
        }
        const key = req.url ?? "";
        if (req.method === "PUT") {
          objects.set(key, {
            body: Buffer.concat(chunks),
            type: String(req.headers["content-type"]),
          });
          res.statusCode = 200;
        } else if (req.method === "GET") {
          const o = objects.get(key);
          res.statusCode = o ? 200 : 404;
          if (o) res.write(o.body);
        } else if (req.method === "DELETE") {
          objects.delete(key);
          res.statusCode = 204;
        }
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const storage = () =>
    new S3Storage(
      {
        endpoint,
        region: "eu-central-1",
        bucket: "dp-media",
        accessKeyId: "test-access",
        secretAccessKey: "test-secret-value",
        forcePathStyle: true,
      },
      globalThis.fetch,
      () => new Date("2026-11-12T10:00:00Z"),
    );

  it("puts, gets and deletes with signed, path-style requests and no ACL", async () => {
    const s = storage();
    const { original } = newImageKeys();
    await s.put(original, Buffer.from("png-bytes"), "image/png");
    expect((await s.get(original))?.toString()).toBe("png-bytes");
    await s.delete(original);
    expect(await s.get(original)).toBeNull();
    const put = seen.find((x) => x.method === "PUT")!;
    expect(put.url).toBe(`/dp-media/${original}`);
    expect(put.auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access\/20261112\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(put.auth).not.toContain("test-secret-value");
    expect(put.acl).toBeUndefined();
    expect(put.type).toBe("image/png");
  });

  it("turns server errors and unreachable endpoints into storage errors", async () => {
    failNext = 1;
    await expect(
      storage().put(newImageKeys().original, Buffer.from("x"), "image/png"),
    ).rejects.toThrow(MediaStorageError);
    const down = new S3Storage({
      endpoint: "http://127.0.0.1:9",
      region: "x",
      bucket: "b",
      accessKeyId: "a",
      secretAccessKey: "s",
      forcePathStyle: true,
    });
    await expect(down.get(newImageKeys().original)).rejects.toThrow(MediaStorageError);
  });

  it("requires https except for local endpoints", () => {
    expect(
      () =>
        new S3Storage({
          endpoint: "http://s3.example.com",
          region: "x",
          bucket: "b",
          accessKeyId: "a",
          secretAccessKey: "s",
          forcePathStyle: true,
        }),
    ).toThrow(/https/);
  });
});

describe("media configuration", () => {
  it("is disabled when unset locally, filesystem or s3 when configured", () => {
    expect(createMediaStorage({})).toBeInstanceOf(DisabledStorage);
    expect(
      createMediaStorage({ DP_MEDIA_STORAGE: "filesystem", DP_MEDIA_DIR: "/data/media" }).kind,
    ).toBe("filesystem");
    const s3 = createMediaStorage({
      DP_MEDIA_STORAGE: "s3",
      DP_S3_ENDPOINT: "https://s3.eu-central-1.amazonaws.com",
      DP_S3_REGION: "eu-central-1",
      DP_S3_BUCKET: "dp-media",
      DP_S3_ACCESS_KEY_ID: "id",
      DP_S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(s3.kind).toBe("s3");
  });

  it("names missing variables, never values, and requires s3 in hosted environments", () => {
    expect(() => createMediaStorage({ DP_MEDIA_STORAGE: "filesystem" })).toThrow(
      "DP_MEDIA_DIR is not set",
    );
    expect(() =>
      createMediaStorage({ DP_MEDIA_STORAGE: "s3", DP_S3_ENDPOINT: "https://x" }),
    ).toThrow("DP_S3_REGION is not set");
    expect(() => createMediaStorage({ DP_MEDIA_STORAGE: "ftp" })).toThrow(MediaConfigError);
    expect(() => createMediaStorage({ DP_DEPLOY_ENV: "production" })).toThrow(/must be s3/);
    expect(() =>
      createMediaStorage({
        DP_DEPLOY_ENV: "staging",
        DP_MEDIA_STORAGE: "filesystem",
        DP_MEDIA_DIR: "/x",
      }),
    ).toThrow(/must be s3/);
    try {
      createMediaStorage({ DP_MEDIA_STORAGE: "s3", DP_S3_ENDPOINT: "not a url ::secret-value" });
    } catch (e) {
      expect(String(e)).not.toContain("secret-value");
    }
  });

  it("the disabled storage fails every call as a storage error", async () => {
    await expect(new DisabledStorage().get("x")).rejects.toThrow(MediaStorageError);
  });
});
