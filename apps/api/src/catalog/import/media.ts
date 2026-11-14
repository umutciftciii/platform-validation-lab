/**
 * DP-158: media stage of the catalogue import. Reads the verified DP-158 manifest and uploads
 * through the existing admin API only (image upload, image alt text, document create, document
 * revision upload): no new storage, no migration, no site link, no publication.
 *
 *  - Every file is read and its SHA-256 and size are checked against the manifest BEFORE the plan
 *    is made; one mismatch refuses the whole run (nothing is written).
 *  - Image: uploaded only to a product that has no image yet, so it becomes the cover (the API
 *    makes the first image the cover); alt text = the manifest's product name. A product whose
 *    images already include this file (same SHA-256) is ALREADY_IMPORTED; any other existing
 *    image is a CONFLICT and nothing is touched.
 *  - PDF: a document of type OTHER ("compiled technical summary", never TDS or COA), access
 *    LEAD_REQUIRED, with one revision = the file. A product whose documents already hold this file
 *    is ALREADY_IMPORTED; any other document is a CONFLICT.
 *  - An interrupted earlier run (our image without alt text, our document without a revision) is
 *    PARTIAL and completed only with `resumePartial`.
 *  - Dry run by default; apply needs the confirm count of the plan, like the catalogue stage.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVISION_NOTE_HEADER,
  UPLOAD_FILENAME_HEADER,
  type CatalogContextResponse,
  type MediaImageEntry,
  type MediaManifest,
  type MediaPdfEntry,
  type ProductDocument,
  type ProductDocumentListResponse,
  type ProductDocumentResponse,
  type ProductImage,
  type ProductImageListResponse,
  type ProductImageResponse,
  type ProductListResponse,
} from "@dream/contracts";
import type { AdminApi } from "./client.js";

export type MediaAction = "CREATE" | "RESUME" | "ALREADY_IMPORTED" | "PARTIAL" | "CONFLICT";

export interface MediaProductState {
  id: string;
  images: Pick<ProductImage, "id" | "sha256" | "altText" | "isCover" | "version">[];
  documents: (Pick<
    ProductDocument,
    "id" | "type" | "title" | "accessPolicy" | "revisionCount" | "version"
  > & { shas: string[] })[];
}

export interface PlannedMedia {
  kind: "image" | "pdf";
  code: string;
  file: string;
  action: MediaAction;
  reason: string | null;
  productId: string | null;
  /** RESUME: the record of the earlier run to complete. */
  existingId: string | null;
}

export interface MediaPlan {
  items: PlannedMedia[];
  counts: Record<MediaAction, number> & { images: number; pdfs: number };
  confirmCount: number;
}

/**
 * Title and description of an imported technical summary (never called TDS or COA). The title
 * starts with the product code: two products can share a document name (ICCSYN 6 Group III and
 * Group III+), and the admin lists documents by title.
 */
export function documentTitle(e: MediaPdfEntry): string {
  return `${e.code} · ${e.nameOnDocument} — technical summary compiled from source documents`.slice(
    0,
    200,
  );
}
export function documentDescription(e: MediaPdfEntry): string {
  const cited = e.citedSourceDocuments.length
    ? ` Cited source documents: ${e.citedSourceDocuments.join("; ")}.`
    : "";
  return (
    "Transcribed from supplied documents (DP-158). Not a TDS or certificate of analysis; " +
    `sample results in it apply to the source batch only.${cited}`
  ).slice(0, 2000);
}

/** Reads every manifest file and checks size and SHA-256; throws on the first mismatch. */
export function verifyFiles(manifest: MediaManifest, root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const base = path.resolve(root);
  for (const f of manifest.files) {
    const full = path.resolve(base, f.file);
    if (!full.startsWith(base + path.sep)) throw new Error(`${f.file}: outside the media root`);
    const bytes = readFileSync(full);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== f.bytes || sha !== f.sha256) {
      throw new Error(
        `${f.file}: does not match the manifest (bytes ${bytes.length}/${f.bytes}, sha256 ${sha})`,
      );
    }
    out.set(f.file, bytes);
  }
  return out;
}

export function planMedia(
  manifest: MediaManifest,
  products: ReadonlyMap<string, MediaProductState>,
  options: { only?: ReadonlySet<string>; resumePartial?: boolean } = {},
): MediaPlan {
  const items: PlannedMedia[] = [];
  for (const f of manifest.files) {
    if (options.only && !options.only.has(f.code)) continue;
    const p = products.get(f.code);
    const base = { kind: f.kind, code: f.code, file: f.file, productId: p?.id ?? null };
    if (!p) {
      items.push({ ...base, action: "CONFLICT", reason: "product not found", existingId: null });
      continue;
    }
    if (f.kind === "image") {
      const own = p.images.find((i) => i.sha256 === f.sha256);
      if (own) {
        if (own.altText === f.altText) {
          items.push({ ...base, action: "ALREADY_IMPORTED", reason: null, existingId: own.id });
        } else if (own.altText === null) {
          items.push({
            ...base,
            action: options.resumePartial ? "RESUME" : "PARTIAL",
            reason: "image uploaded without alt text (interrupted earlier run)",
            existingId: own.id,
          });
        } else {
          items.push({
            ...base,
            action: "CONFLICT",
            reason: `image exists with another alt text "${own.altText}"`,
            existingId: own.id,
          });
        }
      } else if (p.images.length > 0) {
        items.push({
          ...base,
          action: "CONFLICT",
          reason: `product already has ${p.images.length} image(s); left unchanged`,
          existingId: null,
        });
      } else {
        items.push({ ...base, action: "CREATE", reason: null, existingId: null });
      }
      continue;
    }
    const title = documentTitle(f);
    const own = p.documents.find((d) => d.shas.includes(f.sha256));
    const empty = p.documents.find(
      (d) =>
        d.title === title &&
        d.type === "OTHER" &&
        d.accessPolicy === "LEAD_REQUIRED" &&
        d.revisionCount === 0,
    );
    if (own) {
      items.push({ ...base, action: "ALREADY_IMPORTED", reason: null, existingId: own.id });
    } else if (empty && p.documents.length === 1) {
      items.push({
        ...base,
        action: options.resumePartial ? "RESUME" : "PARTIAL",
        reason: "document created without its file (interrupted earlier run)",
        existingId: empty.id,
      });
    } else if (p.documents.length > 0) {
      items.push({
        ...base,
        action: "CONFLICT",
        reason: `product already has ${p.documents.length} document(s); left unchanged`,
        existingId: null,
      });
    } else {
      items.push({ ...base, action: "CREATE", reason: null, existingId: null });
    }
  }
  const counts = {
    CREATE: 0,
    RESUME: 0,
    ALREADY_IMPORTED: 0,
    PARTIAL: 0,
    CONFLICT: 0,
    images: items.filter((i) => i.kind === "image").length,
    pdfs: items.filter((i) => i.kind === "pdf").length,
  };
  for (const i of items) counts[i.action]++;
  return { items, counts, confirmCount: counts.CREATE + counts.RESUME };
}

export interface MediaReport {
  mode: "dry-run" | "apply";
  plan: MediaPlan;
  written: { kind: "image" | "alt" | "document" | "revision"; code: string; id: string }[];
  error: string | null;
}

async function readProducts(
  api: AdminApi,
  codes: ReadonlySet<string>,
): Promise<Map<string, MediaProductState>> {
  const ctx = await api.get<CatalogContextResponse>("/context");
  const site = ctx.sites.find((s) => s.key === "BV");
  if (!site) throw new Error("the session cannot read the BV catalogue");
  const ids = new Map<string, string>();
  for (let page = 1; ; page++) {
    const r = await api.get<ProductListResponse>(
      `/products?siteId=${site.id}&pageSize=100&page=${page}&sort=code`,
    );
    for (const p of r.items) if (codes.has(p.code)) ids.set(p.code, p.id);
    if (page * r.pageSize >= r.total || r.items.length === 0) break;
  }
  const out = new Map<string, MediaProductState>();
  for (const [code, id] of ids) {
    const [imgs, docs] = await Promise.all([
      api.get<ProductImageListResponse>(`/products/${id}/images`),
      api.get<ProductDocumentListResponse>(`/products/${id}/documents`),
    ]);
    out.set(code, {
      id,
      images: imgs.items.map((i) => ({
        id: i.id,
        sha256: i.sha256,
        altText: i.altText,
        isCover: i.isCover,
        version: i.version,
      })),
      documents: docs.items.map((d) => ({
        id: d.id,
        type: d.type,
        title: d.title,
        accessPolicy: d.accessPolicy,
        revisionCount: d.revisionCount,
        version: d.version,
        shas: d.revisions.map((r) => r.sha256),
      })),
    });
  }
  return out;
}

export async function runMedia(
  api: AdminApi,
  manifest: MediaManifest,
  root: string,
  opts: {
    apply: boolean;
    confirm?: number;
    only?: ReadonlySet<string>;
    resumePartial?: boolean;
    log?: (l: string) => void;
  },
): Promise<MediaReport> {
  const log = opts.log ?? (() => {});
  const files = verifyFiles(manifest, root);
  const products = await readProducts(api, new Set(manifest.files.map((f) => f.code)));
  const plan = planMedia(manifest, products, {
    ...(opts.only ? { only: opts.only } : {}),
    resumePartial: opts.resumePartial === true,
  });
  const report: MediaReport = {
    mode: opts.apply ? "apply" : "dry-run",
    plan,
    written: [],
    error: null,
  };
  if (!opts.apply) return report;
  if (opts.confirm !== plan.confirmCount) {
    throw new Error(
      `refusing to apply: --confirm ${opts.confirm ?? "(missing)"} does not match the plan ` +
        `(${plan.confirmCount} file(s) to upload or resume); run the dry run again`,
    );
  }
  const entries = new Map(manifest.files.map((f) => [`${f.kind}:${f.code}`, f]));
  try {
    for (const item of plan.items) {
      if (item.action !== "CREATE" && item.action !== "RESUME") continue;
      const bytes = files.get(item.file) as Buffer;
      const name = path.basename(item.file);
      if (item.kind === "image") {
        const e = entries.get(`image:${item.code}`) as MediaImageEntry;
        let imageId = item.existingId;
        let version: number;
        if (item.action === "CREATE") {
          const up = await api.put<ProductImageResponse>(
            `/products/${item.productId}/images`,
            bytes,
            {
              "content-type": e.mime,
              [UPLOAD_FILENAME_HEADER]: encodeURIComponent(name),
            },
          );
          imageId = up.image.id;
          version = up.image.version;
          report.written.push({ kind: "image", code: item.code, id: imageId });
        } else {
          version = products.get(item.code)!.images.find((i) => i.id === imageId)!.version;
        }
        await api.post<ProductImageResponse>(`/images/${imageId}`, { altText: e.altText, version });
        report.written.push({ kind: "alt", code: item.code, id: imageId as string });
        log(`image ${item.code} ${item.action === "CREATE" ? "uploaded" : "completed"}`);
      } else {
        const e = entries.get(`pdf:${item.code}`) as MediaPdfEntry;
        let documentId = item.existingId;
        if (item.action === "CREATE") {
          const d = await api.post<ProductDocumentResponse>(
            `/products/${item.productId}/documents`,
            {
              type: e.documentType,
              title: documentTitle(e),
              description: documentDescription(e),
              accessPolicy: e.plannedAccessPolicy,
            },
          );
          documentId = d.document.id;
          report.written.push({ kind: "document", code: item.code, id: documentId });
        }
        await api.put<ProductDocumentResponse>(`/documents/${documentId}/revisions`, bytes, {
          "content-type": "application/pdf",
          [UPLOAD_FILENAME_HEADER]: encodeURIComponent(name),
          [REVISION_NOTE_HEADER]: encodeURIComponent(
            `DP-158 import, sha256 ${e.sha256.slice(0, 16)}`,
          ),
        });
        report.written.push({ kind: "revision", code: item.code, id: documentId as string });
        log(`document ${item.code} ${item.action === "CREATE" ? "uploaded" : "completed"}`);
      }
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}
