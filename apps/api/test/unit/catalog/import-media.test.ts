// DP-158: the media stage of the catalogue import (pure plan, file verification, manifest guards).
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaManifestSchema, type MediaManifest } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../../src/catalog/import/cli.js";
import {
  documentDescription,
  documentTitle,
  planMedia,
  verifyFiles,
  type MediaProductState,
} from "../../../src/catalog/import/media.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const IMG = Buffer.from("image bytes");
const PDF = Buffer.from("%PDF-1.4 bytes");
const raw = {
  dp: "DP-158",
  files: [
    {
      kind: "image",
      code: "A-1",
      file: "originals/images/A-1__1.jpg",
      bytes: IMG.length,
      mime: "image/jpeg",
      sha256: sha(IMG),
      altText: "Product A-1",
    },
    {
      kind: "pdf",
      code: "A-1",
      file: "originals/pdfs/A-1__1.pdf",
      bytes: PDF.length,
      mime: "application/pdf",
      sha256: sha(PDF),
      nameOnDocument: "Product A-1",
      documentType: "OTHER",
      citedSourceDocuments: ["Source A.pdf"],
      plannedAccessPolicy: "LEAD_REQUIRED",
      publishToSite: false,
    },
  ],
};
const manifest: MediaManifest = MediaManifestSchema.parse(raw);
const product = (patch: Partial<MediaProductState> = {}): Map<string, MediaProductState> =>
  new Map([["A-1", { id: "p1", images: [], documents: [], ...patch }]]);
const ownDoc = {
  id: "d1",
  type: "OTHER" as const,
  title: documentTitle(manifest.files[1] as never),
  accessPolicy: "LEAD_REQUIRED" as const,
  revisionCount: 1,
  version: 2,
  shas: [sha(PDF)],
};

describe("media plan", () => {
  it("uploads to a product without media and needs the confirm count", () => {
    const p = planMedia(manifest, product());
    expect(p.items.map((i) => [i.kind, i.action])).toEqual([
      ["image", "CREATE"],
      ["pdf", "CREATE"],
    ]);
    expect(p.confirmCount).toBe(2);
  });

  it("is idempotent: our own files are ALREADY_IMPORTED", () => {
    const p = planMedia(
      manifest,
      product({
        images: [{ id: "i1", sha256: sha(IMG), altText: "Product A-1", isCover: true, version: 2 }],
        documents: [ownDoc],
      }),
    );
    expect(p.items.map((i) => i.action)).toEqual(["ALREADY_IMPORTED", "ALREADY_IMPORTED"]);
    expect(p.confirmCount).toBe(0);
  });

  it("never touches other existing media", () => {
    const p = planMedia(
      manifest,
      product({
        images: [{ id: "i9", sha256: "f".repeat(64), altText: null, isCover: true, version: 1 }],
        documents: [
          { ...ownDoc, id: "d9", title: "Real TDS", type: "TDS", shas: ["e".repeat(64)] },
        ],
      }),
    );
    expect(p.items.map((i) => [i.action, i.reason])).toEqual([
      ["CONFLICT", "product already has 1 image(s); left unchanged"],
      ["CONFLICT", "product already has 1 document(s); left unchanged"],
    ]);
  });

  it("completes an interrupted run only on request", () => {
    const state = product({
      images: [{ id: "i1", sha256: sha(IMG), altText: null, isCover: true, version: 2 }],
      documents: [{ ...ownDoc, revisionCount: 0, shas: [] }],
    });
    expect(planMedia(manifest, state).items.map((i) => i.action)).toEqual(["PARTIAL", "PARTIAL"]);
    const resumed = planMedia(manifest, state, { resumePartial: true });
    expect(resumed.items.map((i) => [i.action, i.existingId])).toEqual([
      ["RESUME", "i1"],
      ["RESUME", "d1"],
    ]);
  });

  it("reports a missing product and honours --only", () => {
    expect(planMedia(manifest, new Map()).items.map((i) => i.reason)).toEqual([
      "product not found",
      "product not found",
    ]);
    expect(planMedia(manifest, product(), { only: new Set(["B-2"]) }).items).toEqual([]);
  });

  it("names the document a compiled summary, never a TDS or COA", () => {
    const e = manifest.files[1] as Parameters<typeof documentTitle>[0];
    expect(documentTitle(e)).toBe("Product A-1 — technical summary compiled from source documents");
    expect(documentDescription(e)).toContain("Not a TDS or certificate of analysis");
    expect(documentDescription(e)).toContain("Source A.pdf");
  });
});

describe("file verification", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dp158-"));
  mkdirSync(path.join(root, "originals/images"), { recursive: true });
  mkdirSync(path.join(root, "originals/pdfs"), { recursive: true });
  writeFileSync(path.join(root, "originals/images/A-1__1.jpg"), IMG);
  writeFileSync(path.join(root, "originals/pdfs/A-1__1.pdf"), PDF);
  it("accepts files that match the manifest and refuses any change", () => {
    expect(verifyFiles(manifest, root).size).toBe(2);
    writeFileSync(path.join(root, "originals/pdfs/A-1__1.pdf"), Buffer.from("%PDF-1.4 bytez"));
    expect(() => verifyFiles(manifest, root)).toThrow(/does not match the manifest/);
  });
});

describe("media manifest guards", () => {
  const variant = (patch: (m: typeof raw) => void) => {
    const m = structuredClone(raw);
    patch(m);
    return MediaManifestSchema.safeParse(m).success;
  };
  it("accepts only OTHER, LEAD_REQUIRED, unpublished documents and relative paths", () => {
    expect(variant(() => {})).toBe(true);
    expect(variant((m) => ((m.files[1] as { documentType: string }).documentType = "TDS"))).toBe(
      false,
    );
    expect(
      variant(
        (m) => ((m.files[1] as { plannedAccessPolicy: string }).plannedAccessPolicy = "PUBLIC"),
      ),
    ).toBe(false);
    expect(variant((m) => ((m.files[1] as { publishToSite: boolean }).publishToSite = true))).toBe(
      false,
    );
    expect(variant((m) => (m.files[0]!.file = "../etc/passwd"))).toBe(false);
    expect(variant((m) => (m.files[0]!.file = "/abs/x.jpg"))).toBe(false);
    expect(variant((m) => m.files.push(structuredClone(m.files[0]!)))).toBe(false);
  });
});

describe("cli arguments (media stage)", () => {
  it("runs the media stage on its own", () => {
    expect(parseArgs(["--media", "m.json"])).toMatchObject({ media: "m.json", apply: false });
    expect(() => parseArgs(["--media", "m.json", "--mapping", "x.json"])).toThrow(/separate/);
    expect(() => parseArgs(["--mapping", "x.json", "--media-root", "d"])).toThrow(/only used/);
  });
});
