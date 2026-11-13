/**
 * Technical documents of a product master (PM-5, DP-035; ADR-014): TDS, SDS, COA and other PDFs.
 *
 *  - Metadata, uploads, the active revision and archiving need `product_master:edit` (PLATFORM),
 *    like the master's images. Reading and previewing need `product:read` on any site.
 *  - Showing a document on a site is that site's publication decision: `product:publish` of the
 *    site (BV and Corporate decide independently). A site serves a document only while the
 *    product is live there (PM-3), so unpublishing a product takes its documents off as well.
 *  - Documents are not part of the reviewed master snapshot: a new SDS revision must not wait for
 *    a new product approval. The governance is the site publisher's switch plus the access
 *    policy, which is INTERNAL by default (private-by-default).
 *  - DP-086 (owner decision, ADR-014 D5): the site switch pins a revision. Uploading or activating
 *    a revision never changes what a site serves; the site's publisher confirms the new active
 *    revision explicitly (re-pin). BV and Corporate may serve different revisions.
 *  - Revisions are immutable (trigger + column privileges): a new file is a new revision, which
 *    becomes the active one; an older revision can be made active again. Nothing is deleted;
 *    archiving freezes a document and takes it off every site at once.
 *  - Uploads: the raw PDF is streamed with a 20 MB cap, inspected (pdf-inspect.ts) inside the
 *    processing gate, stored under a fresh random key, then the row and its audit event are
 *    written in one transaction. If the transaction fails, the stored file is deleted again.
 *  - Unknown and out-of-reach ids look the same (404); every change and every refusal is audited.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENTS_PER_PRODUCT_MAX,
  DocumentCreateRequestSchema,
  DocumentSiteRequestSchema,
  DocumentStateRequestSchema,
  DocumentUpdateRequestSchema,
  REVISION_NOTE_HEADER,
  REVISION_NOTE_MAX,
  REVISIONS_PER_DOCUMENT_MAX,
  UPLOAD_FILENAME_HEADER,
  type DocumentAccessPolicy,
  type DocumentDisposition,
  type DocumentRevision,
  type DocumentSite,
  type DocumentSiteState,
  type ProductDocument,
  type ProductDocumentListResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { FaultInjector } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { MEDIA_STORAGE } from "../media/media.module.js";
import { ImageGateBusy, ImageProcessingGate } from "../media/image-gate.js";
import { newDocumentKey, type MediaStorage } from "../media/storage.js";
import { decideDocumentAccess } from "./document-delivery.js";
import { mapDbError, staleVersion } from "./errors.js";
import { sanitizeFilename } from "./image-inspect.js";
import { readLimited } from "./images.service.js";
import { inspectPdf, PdfRejected, pdfFilename } from "./pdf-inspect.js";
import { MASTER, PLATFORM, READ, requireMasterRead, uuidOr404 } from "./specs.service.js";

const PUBLISH = "product:publish";
type Db = ReturnType<StaffAccess["db"]>;

interface RevisionRow {
  id: string;
  documentId: string;
  revisionNumber: number;
  isActive: boolean;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string;
  pageCount: number | null;
  pdfVersion: string | null;
  changeNote: string | null;
  createdAt: Date;
  uploadedBy: { id: string; displayName: string | null };
}

interface DocumentRow {
  id: string;
  productId: string;
  type: ProductDocument["type"];
  title: string;
  description: string | null;
  accessPolicy: DocumentAccessPolicy;
  status: ProductDocument["status"];
  revisionCount: number;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revisions: RevisionRow[];
  sites: { siteId: string; revisionId: string; pinnedAt: Date }[];
}

const DOCUMENT_INCLUDE = {
  revisions: {
    orderBy: { revisionNumber: "desc" },
    include: { uploadedBy: { select: { id: true, displayName: true } } },
  },
  sites: { select: { siteId: true, revisionId: true, pinnedAt: true } },
} as const;

function toRevision(r: RevisionRow): DocumentRevision {
  return {
    id: r.id,
    documentId: r.documentId,
    revisionNumber: r.revisionNumber,
    isActive: r.isActive,
    mimeType: "application/pdf",
    byteSize: r.byteSize,
    sha256: r.sha256,
    originalFilename: r.originalFilename,
    pageCount: r.pageCount,
    pdfVersion: r.pdfVersion,
    changeNote: r.changeNote,
    uploadedBy: { id: r.uploadedBy.id, displayName: r.uploadedBy.displayName },
    createdAt: r.createdAt.toISOString(),
  };
}

/** The effective state of a document on one site (contracts DOCUMENT_SITE_STATES). */
export function siteState(input: {
  status: ProductDocument["status"];
  accessPolicy: DocumentAccessPolicy;
  hasActiveRevision: boolean;
  enabled: boolean;
  productLive: boolean;
}): DocumentSiteState {
  if (input.status === "ARCHIVED") return "archived";
  if (input.accessPolicy === "INTERNAL") return "internal";
  if (!input.hasActiveRevision) return "no_file";
  if (!input.enabled) return "hidden";
  if (!input.productLive) return "product_not_live";
  const access = decideDocumentAccess(input.accessPolicy);
  if (!access.downloadable) return access.reason;
  // DP-042 (ADR-016): a lead-gated document is served after the short form, with a grant.
  if (access.requires === "nothing") return "served";
  if (access.requires === "lead_grant") return "served_on_request";
  return "awaiting_membership";
}

/** ASCII fallback plus the UTF-8 name (RFC 6266). */
export function documentDisposition(kind: DocumentDisposition, name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const PDF_REJECTED_STATUS: Record<string, "UNSUPPORTED_MEDIA_TYPE" | "VALIDATION_FAILED"> = {
  not_pdf: "UNSUPPORTED_MEDIA_TYPE",
  empty: "VALIDATION_FAILED",
  encrypted: "VALIDATION_FAILED",
  active_content: "VALIDATION_FAILED",
  too_complex: "VALIDATION_FAILED",
};

/** Products live per site (PM-3 rules), for the given sites. */
export async function liveSites(db: Db, productId: string, siteIds: readonly string[]) {
  if (siteIds.length === 0) return new Set<string>();
  const pubs = await db.productPublication.findMany({
    where: {
      productId,
      siteId: { in: [...siteIds] },
      status: "PUBLISHED",
      product: { status: { not: "ARCHIVED" } },
    },
    select: { siteId: true, listingId: true },
  });
  if (pubs.length === 0) return new Set<string>();
  const visible = await db.productSiteListing.findMany({
    where: { id: { in: pubs.map((p) => p.listingId) }, visibility: "VISIBLE" },
    select: { id: true },
  });
  const ok = new Set(visible.map((l) => l.id));
  return new Set(pubs.filter((p) => ok.has(p.listingId)).map((p) => p.siteId));
}

function noteFrom(req: IncomingMessage): string | null {
  const raw = req.headers[REVISION_NOTE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  let note: string;
  try {
    note = decodeURIComponent(value);
  } catch {
    throw new ApiError("VALIDATION_FAILED", [{ path: "changeNote", rule: "invalid" }]);
  }
  note = Array.from(note.normalize("NFKC"))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c === 0x0a || (c > 0x1f && (c < 0x7f || c > 0x9f));
    })
    .join("")
    .trim();
  if (note.length > REVISION_NOTE_MAX) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "changeNote", rule: "too_long" }]);
  }
  return note || null;
}

@Injectable()
export class DocumentsService {
  private readonly log = new Logger("ProductDocuments");

  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(FaultInjector) private readonly faults: FaultInjector,
    @Inject(ImageProcessingGate) private readonly gate: ImageProcessingGate,
  ) {}

  /** Platform rows plus the site rows of every site the caller may read products on. */
  private static db(a: StaffAccess): Db {
    return a.db({ siteIds: a.sitesWith(READ), includePlatform: true });
  }

  private async toDocument(a: StaffAccess, db: Db, row: DocumentRow): Promise<ProductDocument> {
    const readable = a.sitesWith(READ);
    const live = await liveSites(db, row.productId, readable);
    const pins = new Map(row.sites.map((s) => [s.siteId, s]));
    const numbers = new Map(row.revisions.map((r) => [r.id, r.revisionNumber]));
    const active = row.revisions.find((r) => r.isActive) ?? null;
    const sites: DocumentSite[] = a.sites
      .filter((s) => readable.includes(s.id))
      .map((s) => {
        const pin = pins.get(s.id);
        return {
          siteId: s.id,
          siteKey: s.key,
          enabled: pin !== undefined,
          pinnedRevision: pin
            ? {
                id: pin.revisionId,
                revisionNumber: numbers.get(pin.revisionId) ?? 0,
                pinnedAt: pin.pinnedAt.toISOString(),
              }
            : null,
          updateAvailable: pin !== undefined && active !== null && active.id !== pin.revisionId,
          state: siteState({
            status: row.status,
            accessPolicy: row.accessPolicy,
            hasActiveRevision: active !== null,
            enabled: pin !== undefined,
            productLive: live.has(s.id),
          }),
          canPublish: a.allows(PUBLISH, { scope: "site", siteId: s.id }),
        };
      });
    return {
      id: row.id,
      productId: row.productId,
      type: row.type,
      title: row.title,
      description: row.description,
      accessPolicy: row.accessPolicy,
      status: row.status,
      version: row.version,
      revisionCount: row.revisionCount,
      activeRevision: active ? toRevision(active) : null,
      revisions: row.revisions.map(toRevision),
      sites,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async load(a: StaffAccess, db: Db, id: string): Promise<ProductDocument> {
    const row = (await db.productDocument.findUnique({
      where: { id },
      include: DOCUMENT_INCLUDE,
    })) as DocumentRow | null;
    if (!row) throw new ApiError("NOT_FOUND");
    return this.toDocument(a, db, row);
  }

  async list(ctx: RequestContext, rawProductId: string): Promise<ProductDocumentListResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await requireMasterRead(a, { type: "product", id: productId });
    const db = DocumentsService.db(a);
    if (!(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
      throw new ApiError("NOT_FOUND");
    }
    const rows = (await db.productDocument.findMany({
      where: { productId },
      include: DOCUMENT_INCLUDE,
      orderBy: [{ status: "asc" }, { type: "asc" }, { createdAt: "asc" }],
      take: DOCUMENTS_PER_PRODUCT_MAX,
    })) as DocumentRow[];
    const items: ProductDocument[] = [];
    for (const row of rows) items.push(await this.toDocument(a, db, row));
    return { items, canEdit: a.allows(MASTER, PLATFORM) };
  }

  async create(
    ctx: RequestContext,
    rawProductId: string,
    body: unknown,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await a.require(MASTER, PLATFORM, { type: "product_document", id: null });
    const input = parseBody(DocumentCreateRequestSchema, body);
    const db = DocumentsService.db(a);
    let id = "";
    try {
      id = await db.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { status: true },
        });
        if (!product) throw new ApiError("NOT_FOUND");
        if (product.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
        }
        const count = await tx.productDocument.count({ where: { productId } });
        if (count >= DOCUMENTS_PER_PRODUCT_MAX) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "too_many_documents" }]);
        }
        const created = await tx.productDocument.create({
          data: {
            productId,
            type: input.type,
            title: input.title,
            description: input.description,
            accessPolicy: input.accessPolicy,
          },
        });
        await a.audit(tx, {
          action: "catalog.document_created",
          resourceType: "product_document",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: { productId, type: created.type, accessPolicy: created.accessPolicy },
        });
        return created.id;
      });
    } catch (e) {
      mapDbError(e);
    }
    return { document: await this.load(a, db, id) };
  }

  /** Loads a document for a master change; out of reach and unknown look the same (404). */
  private static async editable(a: StaffAccess, rawId: string) {
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product_document", id });
    return { id, db: DocumentsService.db(a) };
  }

  async update(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await DocumentsService.editable(a, rawId);
    const input = parseBody(DocumentUpdateRequestSchema, body);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.productDocument.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== input.version) throw staleVersion();
        if (before.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "document_archived" }]);
        }
        const res = await tx.productDocument.updateMany({
          where: { id, version: input.version },
          data: {
            type: input.type,
            title: input.title,
            description: input.description,
            accessPolicy: input.accessPolicy,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        const changed = (["type", "title", "description", "accessPolicy"] as const).filter(
          (k) => before[k] !== input[k],
        );
        await a.audit(tx, {
          action: "catalog.document_updated",
          resourceType: "product_document",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: before.productId,
            changed,
            ...(changed.includes("accessPolicy")
              ? { accessPolicy: { from: before.accessPolicy, to: input.accessPolicy } }
              : {}),
          },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { document: await this.load(a, db, id) };
  }

  async upload(
    ctx: RequestContext,
    rawId: string,
    req: IncomingMessage,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await DocumentsService.editable(a, rawId);
    const doc = await db.productDocument.findUnique({
      where: { id },
      select: { status: true, revisionCount: true, product: { select: { status: true } } },
    });
    if (!doc) {
      req.resume();
      throw new ApiError("NOT_FOUND");
    }
    if (doc.product.status === "ARCHIVED") {
      req.resume();
      throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
    }
    if (doc.status === "ARCHIVED") {
      req.resume();
      throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "document_archived" }]);
    }
    if (doc.revisionCount >= REVISIONS_PER_DOCUMENT_MAX) {
      req.resume();
      throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "too_many_revisions" }]);
    }
    const changeNote = noteFrom(req);
    let data: Buffer;
    let info: ReturnType<typeof inspectPdf>;
    try {
      // Read and inspected only once a processing slot is free (memory bound, image-gate.ts).
      ({ data, info } = await this.gate.run(async () => {
        const body = await readLimited(req, DOCUMENT_MAX_BYTES);
        return { data: body, info: inspectPdf(body) };
      }));
    } catch (e) {
      if (e instanceof ImageGateBusy) {
        req.resume();
        throw new ApiError("RATE_LIMITED", [{ path: "file", rule: "busy" }]);
      }
      if (e instanceof PdfRejected) {
        await a.audit(DocumentsService.db(a), {
          action: "catalog.document_upload_rejected",
          resourceType: "product_document",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: e.detail ? { name: e.detail } : {},
          failure: { reason: `pdf_${e.reason}` },
        });
        throw new ApiError(PDF_REJECTED_STATUS[e.reason] ?? "VALIDATION_FAILED", [
          { path: "file", rule: e.reason },
        ]);
      }
      throw e;
    }
    const rawName = req.headers[UPLOAD_FILENAME_HEADER];
    const filename = pdfFilename(
      sanitizeFilename(Array.isArray(rawName) ? rawName[0] : rawName).replace(
        /^image$/,
        "document",
      ),
    );
    const key = newDocumentKey();
    try {
      await this.storage.put(key, data, "application/pdf");
    } catch (e) {
      await this.removeKey(key);
      this.log.warn(`media storage write failed (${(e as Error).name})`);
      throw new ApiError("STORAGE_UNAVAILABLE");
    }
    try {
      this.faults.check("documents.db.insert");
      await db.$transaction(async (tx) => {
        // Locks the document row and takes the next revision number.
        const bumped = await tx.productDocument.updateMany({
          where: { id, status: "ACTIVE", revisionCount: { lt: REVISIONS_PER_DOCUMENT_MAX } },
          data: { revisionCount: { increment: 1 }, version: { increment: 1 } },
        });
        if (bumped.count !== 1) {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "document_archived" }]);
        }
        const current = await tx.productDocument.findUniqueOrThrow({
          where: { id },
          select: { revisionCount: true, productId: true, accessPolicy: true },
        });
        const previous = await tx.productDocumentRevision.findFirst({
          where: { documentId: id, isActive: true },
          select: { id: true },
        });
        await tx.productDocumentRevision.updateMany({
          where: { documentId: id, isActive: true },
          data: { isActive: false },
        });
        const created = await tx.productDocumentRevision.create({
          data: {
            documentId: id,
            revisionNumber: current.revisionCount,
            isActive: true,
            storageKey: key,
            mimeType: "application/pdf",
            byteSize: info.byteSize,
            sha256: info.sha256,
            originalFilename: filename,
            pageCount: info.pageCount,
            pdfVersion: info.pdfVersion,
            changeNote,
            uploadedById: a.userId,
          },
        });
        await a.audit(tx, {
          action: "catalog.document_revision_uploaded",
          resourceType: "product_document",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: current.productId,
            revisionId: created.id,
            revisionNumber: created.revisionNumber,
            previousActiveRevisionId: previous?.id ?? null,
            byteSize: created.byteSize,
            sha256: created.sha256,
            pageCount: created.pageCount,
            accessPolicy: current.accessPolicy,
          },
        });
      });
    } catch (e) {
      await this.removeKey(key);
      mapDbError(e);
    }
    return { document: await this.load(a, db, id) };
  }

  private async removeKey(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (e) {
      this.log.warn(`document orphan left behind, delete failed (${(e as Error).name})`);
    }
  }

  async activate(
    ctx: RequestContext,
    rawRevisionId: string,
    body: unknown,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const revisionId = uuidOr404(rawRevisionId);
    await a.require(MASTER, PLATFORM, { type: "product_document_revision", id: revisionId });
    const { version } = parseBody(DocumentStateRequestSchema, body);
    const db = DocumentsService.db(a);
    let documentId = "";
    try {
      await db.$transaction(async (tx) => {
        const rev = await tx.productDocumentRevision.findUnique({
          where: { id: revisionId },
          select: { documentId: true, isActive: true, revisionNumber: true },
        });
        if (!rev) throw new ApiError("NOT_FOUND");
        documentId = rev.documentId;
        const doc = await tx.productDocument.findUniqueOrThrow({ where: { id: rev.documentId } });
        if (doc.version !== version) throw staleVersion();
        if (doc.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "document_archived" }]);
        }
        if (rev.isActive) return;
        const res = await tx.productDocument.updateMany({
          where: { id: doc.id, version, status: "ACTIVE" },
          data: { version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const previous = await tx.productDocumentRevision.findFirst({
          where: { documentId: doc.id, isActive: true },
          select: { id: true, revisionNumber: true },
        });
        await tx.productDocumentRevision.updateMany({
          where: { documentId: doc.id, isActive: true },
          data: { isActive: false },
        });
        await tx.productDocumentRevision.updateMany({
          where: { id: revisionId, documentId: doc.id },
          data: { isActive: true },
        });
        await a.audit(tx, {
          action: "catalog.document_revision_activated",
          resourceType: "product_document",
          resourceId: doc.id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: doc.productId,
            revisionId,
            revisionNumber: rev.revisionNumber,
            previousRevisionNumber: previous?.revisionNumber ?? null,
          },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { document: await this.load(a, db, documentId) };
  }

  async setArchived(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    archived: boolean,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await DocumentsService.editable(a, rawId);
    const { version } = parseBody(DocumentStateRequestSchema, body);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.productDocument.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== version) throw staleVersion();
        if ((before.status === "ARCHIVED") === archived) {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
        }
        const res = await tx.productDocument.updateMany({
          where: { id, version },
          data: {
            status: archived ? "ARCHIVED" : "ACTIVE",
            archivedAt: archived ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: archived ? "catalog.document_archived" : "catalog.document_restored",
          resourceType: "product_document",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { productId: before.productId },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { document: await this.load(a, db, id) };
  }

  /**
   * Shows, hides or re-pins a document on one site: that site's publication decision (DP-086).
   * Showing pins the named revision, which must be the active one; the same call on a shown
   * document moves the pin (the publisher's explicit approval of a new revision).
   */
  async setSite(
    ctx: RequestContext,
    rawId: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<{ document: ProductDocument }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const siteId = /^[0-9a-f-]{36}$/i.test(rawSiteId)
      ? rawSiteId.toLowerCase()
      : "00000000-0000-0000-0000-000000000000";
    await a.require(PUBLISH, { scope: "site", siteId }, { type: "product_document", id });
    const { visible, version, revisionId } = parseBody(DocumentSiteRequestSchema, body);
    const siteDb = a.db({ siteIds: [siteId], includePlatform: true });
    try {
      await siteDb.$transaction(async (tx) => {
        const doc = await tx.productDocument.findUnique({
          where: { id },
          select: { version: true, productId: true, accessPolicy: true, status: true },
        });
        if (!doc) throw new ApiError("NOT_FOUND");
        // The publisher decides on what they saw: a changed policy or file needs a new look.
        if (doc.version !== version) throw staleVersion();
        const existing = await tx.productDocumentSite.findFirst({
          where: { documentId: id, siteId },
          select: { id: true, revisionId: true, revision: { select: { revisionNumber: true } } },
        });
        if (!visible) {
          if (!existing) return;
          await tx.productDocumentSite.deleteMany({ where: { documentId: id, siteId } });
          await a.audit(tx, {
            action: "catalog.document_site_hidden",
            resourceType: "product_document",
            resourceId: id,
            siteId,
            permission: PUBLISH,
            metadata: {
              productId: doc.productId,
              accessPolicy: doc.accessPolicy,
              revisionId: existing.revisionId,
              revisionNumber: existing.revision.revisionNumber,
            },
          });
          return;
        }
        if (existing?.revisionId === revisionId) return;
        const hasFile = await tx.productDocumentRevision.count({
          where: { documentId: id, isActive: true },
        });
        if (doc.status !== "ACTIVE" || doc.accessPolicy === "INTERNAL" || hasFile === 0) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "not_publishable" }]);
        }
        // Only the active revision can be confirmed for a site (the trigger checks it again).
        const target = await tx.productDocumentRevision.findFirst({
          where: { id: revisionId, documentId: id },
          select: { id: true, isActive: true, revisionNumber: true },
        });
        if (!target) throw new ApiError("NOT_FOUND");
        if (!target.isActive) {
          throw new ApiError("CONFLICT_STATE", [{ path: "revisionId", rule: "not_active" }]);
        }
        if (existing) {
          await tx.productDocumentSite.updateMany({
            where: { id: existing.id, siteId },
            data: { revisionId: target.id, pinnedAt: new Date() },
          });
        } else {
          await tx.productDocumentSite.create({
            data: { documentId: id, siteId, revisionId: target.id },
          });
        }
        await a.audit(tx, {
          action: existing
            ? "catalog.document_site_revision_pinned"
            : "catalog.document_site_shown",
          resourceType: "product_document",
          resourceId: id,
          siteId,
          permission: PUBLISH,
          metadata: {
            productId: doc.productId,
            accessPolicy: doc.accessPolicy,
            revisionId: target.id,
            revisionNumber: target.revisionNumber,
            ...(existing
              ? {
                  previousRevisionId: existing.revisionId,
                  previousRevisionNumber: existing.revision.revisionNumber,
                }
              : {}),
          },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { document: await this.load(a, DocumentsService.db(a), id) };
  }

  /** The bytes of one revision for staff (preview inline or download as attachment). */
  async file(
    ctx: RequestContext,
    rawRevisionId: string,
    disposition: string,
  ): Promise<{ data: Buffer; filename: string; disposition: DocumentDisposition }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawRevisionId);
    await requireMasterRead(a, { type: "product_document_revision", id });
    if (disposition !== "inline" && disposition !== "attachment") throw new ApiError("NOT_FOUND");
    const db = DocumentsService.db(a);
    const row = await db.productDocumentRevision.findUnique({
      where: { id },
      select: { storageKey: true, originalFilename: true, documentId: true, revisionNumber: true },
    });
    if (!row) throw new ApiError("NOT_FOUND");
    let data: Buffer | null;
    try {
      data = await this.storage.get(row.storageKey);
    } catch (e) {
      this.log.warn(`media storage read failed (${(e as Error).name})`);
      throw new ApiError("STORAGE_UNAVAILABLE");
    }
    if (!data) {
      this.log.warn("media object missing for an existing document revision");
      throw new ApiError("NOT_FOUND");
    }
    await a.audit(db, {
      action: "catalog.document_file_read",
      resourceType: "product_document",
      resourceId: row.documentId,
      siteId: null,
      permission: READ,
      metadata: { revisionId: id, revisionNumber: row.revisionNumber, disposition },
    });
    return { data, filename: row.originalFilename, disposition };
  }
}
