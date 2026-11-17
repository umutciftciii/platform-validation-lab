// DP-205: the documents stage of the catalogue import (pure plan, upload verification, manifest
// guards, command line). The API calls are covered by test/integration/catalog.int.test.ts (15).
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DocumentLinkManifestSchema,
  type DocumentLinkManifest,
  type ProductDocument,
} from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { documentsSummary, parseArgs } from "../../../src/catalog/import/cli.js";
import {
  planDocumentLinks,
  verifyUploads,
  type LinkProductState,
} from "../../../src/catalog/import/documents.js";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const A = sha("file A");
const B = sha("file B");
const NEW = Buffer.from("%PDF-1.7 overview");
const SITE = "00000000-0000-7000-8000-0000000000b1";
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const raw = {
  dp: "DP-205",
  site: "BV",
  documentType: "OTHER",
  accessPolicy: "LEAD_REQUIRED",
  documents: [
    {
      code: "a-1",
      sourceUrl: "https://dreampetroleumbv.com/assets/specs/a-1.pdf",
      sha256: A,
      bytes: 6,
      upload: null,
    },
    {
      code: "C-1",
      sourceUrl: "https://dreampetroleumbv.com/assets/specs/overview.pdf",
      sha256: sha(NEW),
      bytes: NEW.length,
      upload: { file: "originals/overview.pdf", title: "Overview", description: null },
    },
  ],
};
const manifest = (): DocumentLinkManifest => DocumentLinkManifestSchema.parse(raw);

function rev(n: number, fileSha: string, active: boolean) {
  return {
    id: uuid(100 + n),
    documentId: uuid(1),
    revisionNumber: n,
    isActive: active,
    mimeType: "application/pdf" as const,
    byteSize: 6,
    sha256: fileSha,
    originalFilename: "a.pdf",
    pageCount: 1,
    pdfVersion: "1.4",
    changeNote: null,
    uploadedBy: { id: uuid(9), displayName: null },
    createdAt: "2026-11-17T00:00:00.000Z",
  };
}

function doc(over: Partial<ProductDocument> = {}, pinned: number | null = null): ProductDocument {
  const revisions = over.revisions ?? [rev(1, A, true)];
  const active = revisions.find((r) => r.isActive) ?? null;
  const pinnedRev = pinned === null ? null : revisions.find((r) => r.revisionNumber === pinned)!;
  return {
    id: uuid(1),
    productId: uuid(2),
    type: "OTHER",
    title: "A-1 summary",
    description: null,
    accessPolicy: "LEAD_REQUIRED",
    status: "ACTIVE",
    version: 3,
    revisionCount: revisions.length,
    activeRevision: active,
    revisions,
    sites: [
      {
        siteId: SITE,
        siteKey: "BV",
        enabled: pinnedRev !== null,
        pinnedRevision: pinnedRev
          ? { id: pinnedRev.id, revisionNumber: pinnedRev.revisionNumber, pinnedAt: "x" }
          : null,
        updateAvailable: false,
        state: pinnedRev ? "served_on_request" : "hidden",
        canPublish: true,
      },
    ],
    archivedAt: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    ...over,
  } as ProductDocument;
}

const state = (code: string, documents: ProductDocument[]): [string, LinkProductState] => [
  code,
  { id: uuid(code === "A-1" ? 2 : 3), slug: code.toLowerCase(), documents },
];
const plan = (a: ProductDocument[], c: ProductDocument[] = [], resumePartial = false) =>
  planDocumentLinks(manifest(), SITE, new Map([state("A-1", a), state("C-1", c)]), {
    resumePartial,
  });

describe("DP-205 manifest", () => {
  it("accepts the owner decisions only: BV, OTHER, LEAD_REQUIRED, https sources", () => {
    expect(manifest().documents[0]!.code).toBe("A-1");
    for (const bad of [
      { site: "CORPORATE" },
      { documentType: "TDS" },
      { accessPolicy: "PUBLIC" },
      { dp: "DP-158" },
      { extra: true },
    ]) {
      expect(DocumentLinkManifestSchema.safeParse({ ...raw, ...bad }).success).toBe(false);
    }
    const entry = (o: object) => ({ ...raw, documents: [{ ...raw.documents[0], ...o }] });
    expect(
      DocumentLinkManifestSchema.safeParse(entry({ sourceUrl: "http://x/a.pdf" })).success,
    ).toBe(false);
    expect(DocumentLinkManifestSchema.safeParse(entry({ sha256: "A".repeat(64) })).success).toBe(
      false,
    );
    expect(
      DocumentLinkManifestSchema.safeParse(
        entry({ upload: { file: "../x.pdf", title: "t", description: null } }),
      ).success,
    ).toBe(false);
    // one file, one entry
    expect(
      DocumentLinkManifestSchema.safeParse({
        ...raw,
        documents: [raw.documents[0], { ...raw.documents[0], code: "B-1" }],
      }).success,
    ).toBe(false);
  });
});

describe("DP-205 plan", () => {
  it("links the document holding the file, uploads only a file nobody holds", () => {
    const p = plan([doc()]);
    expect(p.items.map((i) => [i.code, i.action, i.documentId, i.publicPath])).toEqual([
      ["A-1", "LINK", uuid(1), `/products/a-1/documents/${uuid(1)}`],
      ["C-1", "UPLOAD_AND_LINK", null, null],
    ]);
    expect(p.confirmCount).toBe(2);
  });

  it("is idempotent: a document BV already serves at that revision is ALREADY_LINKED", () => {
    const p = plan([doc({}, 1)]);
    expect(p.items[0]!.action).toBe("ALREADY_LINKED");
    expect(p.confirmCount).toBe(1);
  });

  it("an uploaded overview is found by its hash, never uploaded twice", () => {
    const overview = doc({
      id: uuid(5),
      title: "Overview",
      revisions: [{ ...rev(1, sha(NEW), true), documentId: uuid(5) }],
    });
    expect(plan([doc({}, 1)], [overview]).items[1]!.action).toBe("LINK");
    const linked = doc(
      {
        id: uuid(5),
        title: "Overview",
        revisions: [{ ...rev(1, sha(NEW), true), documentId: uuid(5) }],
      },
      1,
    );
    expect(plan([doc({}, 1)], [linked]).confirmCount).toBe(0);
  });

  it("leaves every decision made in the admin alone (CONFLICT, nothing planned)", () => {
    const cases: [ProductDocument[], RegExp][] = [
      [[doc({ status: "ARCHIVED" })], /archived/],
      [[doc({ accessPolicy: "PUBLIC" })], /PUBLIC/],
      [[doc({ revisions: [rev(1, A, false), rev(2, B, true)] })], /another revision/],
      [[doc({ revisions: [rev(1, A, true), rev(2, B, false)] }, 2)], /BV serves revision 2/],
      [[doc(), doc({ id: uuid(7) })], /in 2 documents/],
      [[], /no document of this product holds the file/],
    ];
    for (const [docs, reason] of cases) {
      const item = plan(docs).items[0]!;
      expect(item.action).toBe("CONFLICT");
      expect(item.reason).toMatch(reason);
    }
    // a pinned older revision is the publisher's: never moved by the import
    expect(
      plan([doc({ revisions: [rev(1, B, false), rev(2, A, true)] }, 1)]).items[0]!.action,
    ).toBe("CONFLICT");
  });

  it("a missing product is a CONFLICT; --only limits the plan", () => {
    const p = planDocumentLinks(manifest(), SITE, new Map([state("C-1", [])]));
    expect(p.items[0]).toMatchObject({
      code: "A-1",
      action: "CONFLICT",
      reason: "product not found",
    });
    const only = planDocumentLinks(manifest(), SITE, new Map([state("C-1", [])]), {
      only: new Set(["C-1"]),
    });
    expect(only.items.map((i) => i.code)).toEqual(["C-1"]);
  });

  it("an interrupted upload is PARTIAL, completed only on request; another file is a CONFLICT", () => {
    const empty = doc({ id: uuid(6), title: "Overview", revisions: [], activeRevision: null });
    expect(plan([doc()], [empty]).items[1]!.action).toBe("PARTIAL");
    const resumed = plan([doc()], [empty], true).items[1]!;
    expect([resumed.action, resumed.documentId]).toEqual(["RESUME", uuid(6)]);
    const other = doc({
      id: uuid(6),
      title: "Overview",
      revisions: [{ ...rev(1, B, true), documentId: uuid(6) }],
    });
    expect(plan([doc()], [other]).items[1]!.reason).toMatch(/another file/);
  });
});

describe("DP-205 upload verification and command line", () => {
  it("refuses an upload file that is not the manifest's file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dp-205-unit-"));
    mkdirSync(path.join(root, "originals"));
    writeFileSync(path.join(root, "originals", "overview.pdf"), NEW);
    expect(verifyUploads(manifest(), root).get(sha(NEW))).toEqual(NEW);
    writeFileSync(path.join(root, "originals", "overview.pdf"), Buffer.from("changed"));
    expect(() => verifyUploads(manifest(), root)).toThrow(/does not match the manifest/);
  });

  it("parses the documents stage as its own stage", () => {
    expect(parseArgs(["--documents", "d.json", "--media-root", "r"])).toMatchObject({
      documents: "d.json",
      mediaRoot: "r",
      apply: false,
    });
    expect(() => parseArgs(["--documents", "d.json", "--media", "m.json"])).toThrow(/separate/);
    expect(() => parseArgs(["--apply"])).toThrow(/--documents/);
  });

  it("prints every item with the public request path", () => {
    const text = documentsSummary({
      mode: "dry-run",
      plan: plan([doc()]),
      written: [],
      error: null,
    });
    expect(text).toContain(`link A-1 ${A.slice(0, 12)} -> /products/a-1/documents/${uuid(1)}`);
    expect(text).toContain("--apply --confirm 2");
  });
});
