// PM-3: orphan clean-up of the media storage — only unreferenced keys and stray temporary files
// older than the grace period are deleted; anything else is reported and kept.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyCleanup, planCleanup, referencedKeys } from "../../../src/media/cleanup.js";
import { FilesystemStorage } from "../../../src/media/filesystem.js";
import { parseListObjects } from "../../../src/media/s3.js";
import { newImageKeys } from "../../../src/media/storage.js";

const root = mkdtempSync(path.join(tmpdir(), "dp-media-cleanup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const DAY = 24 * 3_600_000;

function put(rel: string, ageMs: number) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "x");
  const t = new Date(Date.now() - ageMs);
  utimesSync(p, t, t);
}

describe("media orphan clean-up", () => {
  it("deletes old orphans and strays, keeps referenced, young and unknown files", async () => {
    const live = newImageKeys();
    const orphan = newImageKeys();
    const young = newImageKeys();
    for (const k of Object.values(live)) put(k, 3 * DAY);
    for (const k of Object.values(orphan)) put(k, 3 * DAY);
    put(young.original, 60_000);
    put(`${orphan.original.replace("original", "display.webp")}.0123456789ab.tmp`, 3 * DAY);
    put("products/README.txt", 3 * DAY);
    const storage = new FilesystemStorage(root);
    const referenced = referencedKeys([
      {
        storageKey: live.original,
        variants: { display: { key: live.display }, thumb: { key: live.thumb } },
      },
    ]);
    const plan = await planCleanup(storage, referenced, new Date(), 24);
    expect(plan.referenced).toBe(3);
    expect(plan.young).toBe(1);
    expect(plan.unknown).toEqual(["products/README.txt"]);
    expect(plan.orphans.map((o) => o.kind).sort()).toEqual(["orphan", "orphan", "orphan", "stray"]);
    expect(await applyCleanup(storage, plan)).toEqual({ deleted: 4, failed: 0 });
    expect(await storage.pruneEmptyDirs()).toBe(1);
    const left = readdirSync(path.join(root, "products")).sort();
    expect(left).toEqual(
      ["README.txt", live.original.split("/")[1]!, young.original.split("/")[1]!].sort(),
    );
    const again = await planCleanup(storage, referenced, new Date(), 24);
    expect(again.orphans).toEqual([]);
  });

  it("refuses to delete a stray name that is not the adapter's own temporary file", async () => {
    const storage = new FilesystemStorage(root);
    await expect(storage.deleteStray("products/README.txt")).rejects.toThrow(/invalid stray/);
    await expect(storage.deleteStray("../etc/passwd")).rejects.toThrow(/invalid stray/);
  });

  it("parses an S3 ListObjectsV2 page", () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>
      <Contents><Key>products/${"a".repeat(32)}/original</Key><LastModified>2026-11-01T10:00:00.000Z</LastModified><Size>1234</Size></Contents>
      <Contents><Key>products/odd&amp;name</Key><LastModified>2026-11-02T10:00:00.000Z</LastModified><Size>5</Size></Contents>
    </ListBucketResult>`;
    expect(parseListObjects(xml)).toEqual([
      {
        key: `products/${"a".repeat(32)}/original`,
        size: 1234,
        lastModified: new Date("2026-11-01T10:00:00.000Z"),
      },
      { key: "products/odd&name", size: 5, lastModified: new Date("2026-11-02T10:00:00.000Z") },
    ]);
  });
});
