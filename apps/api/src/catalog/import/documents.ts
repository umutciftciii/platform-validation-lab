/**
 * DP-205: documents stage of the catalogue import. Makes the PDFs published on the current
 * dreampetroleumbv.com available on the BV site of the platform, unchanged, through the existing
 * admin API only (document create, revision upload, the site publisher's pin of DP-086): no new
 * storage, no migration, no new approval step, no publication of products.
 *
 *  - The manifest (DP-205, outside the repository) names every file by product code, live URL,
 *    SHA-256 and size. The platform document holding exactly that file is found by SHA-256; files
 *    are never uploaded twice and documents never duplicated.
 *  - LINK: the document is ACTIVE, LEAD_REQUIRED, its active revision is the manifest's file and
 *    BV does not show it yet -> the BV publisher's pin of that revision.
 *  - ALREADY_LINKED: BV already serves exactly that revision; nothing is written.
 *  - UPLOAD_AND_LINK: only for an entry with `upload` whose file the product does not hold yet:
 *    the file on disk must match the manifest; a document OTHER/LEAD_REQUIRED is created, the file
 *    uploaded as its first revision and pinned for BV.
 *  - PARTIAL / RESUME: an earlier run created that document but stopped before the file was
 *    uploaded; completed only with `resumePartial`.
 *  - CONFLICT: anything the company or a publisher has decided differently since (archived,
 *    another policy, another active revision, BV pinned to another revision, the file in more than
 *    one document, the product missing). Nothing is touched; the admin is where it is resolved.
 *  - Type, title, description and policy of an existing document are never changed.
 *  - Dry run by default; apply needs the confirm count of the plan, like the other stages.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVISION_NOTE_HEADER,
  UPLOAD_FILENAME_HEADER,
  type CatalogContextResponse,
  type DocumentLinkEntry,
  type DocumentLinkManifest,
  type ProductDocument,
  type ProductDocumentListResponse,
  type ProductDocumentResponse,
  type ProductListResponse,
} from "@dream/contracts";
import type { AdminApi } from "./client.js";

export type DocumentLinkAction =
  "LINK" | "ALREADY_LINKED" | "UPLOAD_AND_LINK" | "RESUME" | "PARTIAL" | "CONFLICT";

export interface LinkProductState {
  id: string;
  slug: string;
  documents: ProductDocument[];
}

export interface PlannedDocumentLink {
  code: string;
  sha256: string;
  sourceUrl: string;
  action: DocumentLinkAction;
  reason: string | null;
  productId: string | null;
  /** The platform document (found by SHA-256, or the PARTIAL one); null before an upload. */
  documentId: string | null;
  /** Public BV path of the request form once the product is live there. */
  publicPath: string | null;
}

export interface DocumentLinkPlan {
  siteId: string;
  items: PlannedDocumentLink[];
  counts: Record<DocumentLinkAction, number>;
  confirmCount: number;
}

const bvSite = (d: ProductDocument) => d.sites.find((s) => s.siteKey === "BV");

/** Reads every upload file of the manifest and checks size and SHA-256; throws on a mismatch. */
export function verifyUploads(manifest: DocumentLinkManifest, root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const base = path.resolve(root);
  for (const d of manifest.documents) {
    if (!d.upload) continue;
    const full = path.resolve(base, d.upload.file);
    if (!full.startsWith(base + path.sep)) throw new Error(`${d.upload.file}: outside the root`);
    const bytes = readFileSync(full);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== d.bytes || sha !== d.sha256) {
      throw new Error(
        `${d.upload.file}: does not match the manifest (bytes ${bytes.length}/${d.bytes}, sha256 ${sha})`,
      );
    }
    out.set(d.sha256, bytes);
  }
  return out;
}

function planOne(
  e: DocumentLinkEntry,
  p: LinkProductState | undefined,
  options: { resumePartial?: boolean },
): Omit<PlannedDocumentLink, "code" | "sha256" | "sourceUrl"> {
  if (!p) {
    return {
      action: "CONFLICT",
      reason: "product not found",
      productId: null,
      documentId: null,
      publicPath: null,
    };
  }
  const at = (documentId: string | null) => ({
    productId: p.id,
    documentId,
    publicPath: documentId ? `/products/${p.slug}/documents/${documentId}` : null,
  });
  const holders = p.documents.filter((d) => d.revisions.some((r) => r.sha256 === e.sha256));
  if (holders.length > 1) {
    return {
      action: "CONFLICT",
      reason: `the file is in ${holders.length} documents of this product; left unchanged`,
      ...at(null),
    };
  }
  const doc = holders[0];
  if (doc) {
    const conflict = (reason: string) => ({ action: "CONFLICT" as const, reason, ...at(doc.id) });
    if (doc.status !== "ACTIVE") return conflict("document is archived");
    if (doc.accessPolicy !== "LEAD_REQUIRED") {
      return conflict(`access policy is ${doc.accessPolicy}, not LEAD_REQUIRED`);
    }
    if (doc.activeRevision?.sha256 !== e.sha256) {
      return conflict("another revision of this document is active (changed in the admin)");
    }
    const site = bvSite(doc);
    if (site?.pinnedRevision) {
      return site.pinnedRevision.id === doc.activeRevision.id
        ? { action: "ALREADY_LINKED", reason: null, ...at(doc.id) }
        : conflict(
            `BV serves revision ${site.pinnedRevision.revisionNumber}; left to its publisher`,
          );
    }
    return { action: "LINK", reason: null, ...at(doc.id) };
  }
  if (!e.upload) {
    return {
      action: "CONFLICT",
      reason: "no document of this product holds the file (and the entry has no upload)",
      ...at(null),
    };
  }
  const sameTitle = p.documents.filter((d) => d.title === e.upload!.title);
  const empty = sameTitle.find(
    (d) =>
      d.revisionCount === 0 &&
      d.type === "OTHER" &&
      d.accessPolicy === "LEAD_REQUIRED" &&
      d.status === "ACTIVE",
  );
  if (empty && sameTitle.length === 1) {
    return {
      action: options.resumePartial ? "RESUME" : "PARTIAL",
      reason: "document created without its file (interrupted earlier run)",
      ...at(empty.id),
    };
  }
  if (sameTitle.length > 0) {
    return {
      action: "CONFLICT",
      reason: "a document with this title holds another file; left unchanged",
      ...at(null),
    };
  }
  return { action: "UPLOAD_AND_LINK", reason: null, ...at(null) };
}

export function planDocumentLinks(
  manifest: DocumentLinkManifest,
  siteId: string,
  products: ReadonlyMap<string, LinkProductState>,
  options: { only?: ReadonlySet<string>; resumePartial?: boolean } = {},
): DocumentLinkPlan {
  const items: PlannedDocumentLink[] = [];
  for (const e of manifest.documents) {
    if (options.only && !options.only.has(e.code)) continue;
    items.push({
      code: e.code,
      sha256: e.sha256,
      sourceUrl: e.sourceUrl,
      ...planOne(e, products.get(e.code), options),
    });
  }
  const counts: Record<DocumentLinkAction, number> = {
    LINK: 0,
    ALREADY_LINKED: 0,
    UPLOAD_AND_LINK: 0,
    RESUME: 0,
    PARTIAL: 0,
    CONFLICT: 0,
  };
  for (const i of items) counts[i.action]++;
  return {
    siteId,
    items,
    counts,
    confirmCount: counts.LINK + counts.UPLOAD_AND_LINK + counts.RESUME,
  };
}

export interface DocumentLinkReport {
  mode: "dry-run" | "apply";
  plan: DocumentLinkPlan;
  written: { kind: "document" | "revision" | "link"; code: string; id: string }[];
  error: string | null;
}

async function readProducts(
  api: AdminApi,
  codes: ReadonlySet<string>,
): Promise<{ siteId: string; products: Map<string, LinkProductState> }> {
  const ctx = await api.get<CatalogContextResponse>("/context");
  const site = ctx.sites.find((s) => s.key === "BV");
  if (!site) throw new Error("the session cannot read the BV catalogue");
  const found = new Map<string, { id: string; slug: string }>();
  for (let page = 1; ; page++) {
    const r = await api.get<ProductListResponse>(
      `/products?siteId=${site.id}&pageSize=100&page=${page}&sort=code`,
    );
    for (const p of r.items) if (codes.has(p.code)) found.set(p.code, { id: p.id, slug: p.slug });
    if (page * r.pageSize >= r.total || r.items.length === 0) break;
  }
  const products = new Map<string, LinkProductState>();
  for (const [code, p] of found) {
    const docs = await api.get<ProductDocumentListResponse>(`/products/${p.id}/documents`);
    products.set(code, { ...p, documents: docs.items });
  }
  return { siteId: site.id, products };
}

/** The pin of DP-086: the BV publisher confirms the active revision, at the version read. */
async function pin(api: AdminApi, siteId: string, doc: ProductDocument): Promise<void> {
  if (!doc.activeRevision) throw new Error(`document ${doc.id} has no active revision`);
  await api.post<ProductDocumentResponse>(`/documents/${doc.id}/sites/${siteId}`, {
    visible: true,
    version: doc.version,
    revisionId: doc.activeRevision.id,
  });
}

export async function runDocumentLinks(
  api: AdminApi,
  manifest: DocumentLinkManifest,
  root: string,
  opts: {
    apply: boolean;
    confirm?: number;
    only?: ReadonlySet<string>;
    resumePartial?: boolean;
    log?: (l: string) => void;
  },
): Promise<DocumentLinkReport> {
  const log = opts.log ?? (() => {});
  const files = verifyUploads(manifest, root);
  const { siteId, products } = await readProducts(
    api,
    new Set(manifest.documents.map((d) => d.code)),
  );
  const plan = planDocumentLinks(manifest, siteId, products, {
    ...(opts.only ? { only: opts.only } : {}),
    resumePartial: opts.resumePartial === true,
  });
  const report: DocumentLinkReport = {
    mode: opts.apply ? "apply" : "dry-run",
    plan,
    written: [],
    error: null,
  };
  if (!opts.apply) return report;
  if (opts.confirm !== plan.confirmCount) {
    throw new Error(
      `refusing to apply: --confirm ${opts.confirm ?? "(missing)"} does not match the plan ` +
        `(${plan.confirmCount} document(s) to link or upload); run the dry run again`,
    );
  }
  const entries = new Map(manifest.documents.map((d) => [d.sha256, d]));
  try {
    for (const item of plan.items) {
      if (item.action === "LINK") {
        const doc = products
          .get(item.code)!
          .documents.find((d) => d.id === item.documentId) as ProductDocument;
        await pin(api, siteId, doc);
        report.written.push({ kind: "link", code: item.code, id: doc.id });
        log(`document ${item.code} linked to BV`);
        continue;
      }
      if (item.action !== "UPLOAD_AND_LINK" && item.action !== "RESUME") continue;
      const e = entries.get(item.sha256) as DocumentLinkEntry;
      const upload = e.upload!;
      let documentId = item.documentId;
      if (item.action === "UPLOAD_AND_LINK") {
        const d = await api.post<ProductDocumentResponse>(`/products/${item.productId}/documents`, {
          type: manifest.documentType,
          title: upload.title,
          description: upload.description,
          accessPolicy: manifest.accessPolicy,
        });
        documentId = d.document.id;
        report.written.push({ kind: "document", code: item.code, id: documentId });
      }
      const up = await api.put<ProductDocumentResponse>(
        `/documents/${documentId}/revisions`,
        files.get(item.sha256) as Buffer,
        {
          "content-type": "application/pdf",
          [UPLOAD_FILENAME_HEADER]: encodeURIComponent(path.basename(upload.file)),
          [REVISION_NOTE_HEADER]: encodeURIComponent(
            `DP-205 import from ${e.sourceUrl}, sha256 ${e.sha256.slice(0, 16)}`,
          ),
        },
      );
      report.written.push({ kind: "revision", code: item.code, id: documentId as string });
      // the API computed the hash of what it stored: pin only that exact file
      if (up.document.activeRevision?.sha256 !== e.sha256) {
        throw new Error(`document ${documentId}: the stored file is not the manifest's file`);
      }
      await pin(api, siteId, up.document);
      report.written.push({ kind: "link", code: item.code, id: documentId as string });
      item.documentId = documentId;
      item.publicPath = `/products/${products.get(item.code)!.slug}/documents/${documentId}`;
      log(`document ${item.code} uploaded and linked to BV`);
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}
