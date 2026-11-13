/**
 * Product cross-references (PM-6, DP-036; ADR-015): one of our product masters related to one
 * global product, SIMILAR or VERIFIED.
 *
 * Authorization (no new permission; the PM-3 model):
 *  - read: `product:read` on any site (masters are shared); site rows only of readable sites;
 *  - create, change, request verification, remove, restore: `product_master:edit` (PLATFORM);
 *  - verify and reject a request: `product:approve` (PLATFORM), and not the requester or anyone
 *    who changed the relation since the last decision (separation of duties: 403 own_change,
 *    audited; the trigger refuses it again);
 *  - mark a pending or verified relation SIMILAR again (with a reason): either of the above;
 *  - show on a site: `product:publish` of that site only, with the publisher's responsibility
 *    acknowledgement (DP-091; audited with user, time and statement version).
 *
 * VERIFIED needs: a technical comparison, the active revision of an active PM-5 document of the
 * same product as evidence, the requester and the verifier. The verification records the spec
 * fingerprint and the global product version; xref-rules.ts decides whether it still holds.
 * Every transition names the version it was based on and writes a history event and an audit
 * event in the same transaction. Unknown and out-of-reach ids look the same (404).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CrossReferenceCreateRequestSchema,
  CrossReferenceReasonRequestSchema,
  CrossReferenceRequestVerificationSchema,
  CrossReferenceSiteRequestSchema,
  CrossReferenceStateRequestSchema,
  CrossReferenceUpdateRequestSchema,
  CrossReferenceVerifyRequestSchema,
  XREF_HISTORY_MAX,
  XREFS_PER_PRODUCT_MAX,
  type CrossReferenceAction,
  type CrossReferenceSite,
  type CrossReferenceStatus,
  type ProductCrossReference,
  type ProductCrossReferenceListResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { liveSites } from "./documents.service.js";
import { mapDbError, staleVersion } from "./errors.js";
import {
  GLOBAL_PRODUCT_INCLUDE,
  toGlobalProduct,
  type GlobalProductRow,
} from "./global-catalog.service.js";
import type { ScopedTx } from "./master.js";
import { MASTER, PLATFORM, READ, requireMasterRead, uuidOr404 } from "./specs.service.js";
import {
  crossReferenceSiteState,
  specFingerprint,
  staleReasons,
  verificationState,
  type VerificationFacts,
} from "./xref-rules.js";

const APPROVE = "product:approve";
const PUBLISH = "product:publish";
const RESOURCE = "product_cross_reference";
type Db = ReturnType<StaffAccess["db"]>;
type AnyDb = Db | ScopedTx;

interface UserRow {
  id: string;
  displayName: string | null;
}
const USER = { select: { id: true, displayName: true } } as const;
const userRef = (u: UserRow | null) =>
  u ? { id: u.id, name: u.displayName ?? "Staff user" } : null;

interface XrefRow {
  id: string;
  productId: string;
  globalProductId: string;
  status: CrossReferenceStatus;
  description: string | null;
  comparison: string | null;
  editorIds: string[];
  sourceDocumentId: string | null;
  sourceRevisionId: string | null;
  requestedById: string | null;
  requestedAt: Date | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  verifiedSpecHash: string | null;
  verifiedGlobalVersion: number | null;
  removedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  globalProduct: GlobalProductRow;
  sourceRevision: {
    id: string;
    revisionNumber: number;
    isActive: boolean;
    document: { id: string; title: string; type: "TDS" | "SDS" | "COA" | "OTHER"; status: string };
  } | null;
  requestedBy: UserRow | null;
  verifiedBy: UserRow | null;
  events: {
    id: string;
    action: CrossReferenceAction;
    fromStatus: CrossReferenceStatus | null;
    toStatus: CrossReferenceStatus;
    version: number;
    comment: string | null;
    sourceRevisionId: string | null;
    createdAt: Date;
    actor: UserRow;
  }[];
  sites: { siteId: string }[];
}

const XREF_INCLUDE = {
  globalProduct: { include: GLOBAL_PRODUCT_INCLUDE },
  sourceRevision: {
    select: {
      id: true,
      revisionNumber: true,
      isActive: true,
      document: { select: { id: true, title: true, type: true, status: true } },
    },
  },
  requestedBy: USER,
  verifiedBy: USER,
  events: { orderBy: { createdAt: "desc" }, take: XREF_HISTORY_MAX, include: { actor: USER } },
  sites: { select: { siteId: true } },
} as const;

/** The fields cleared whenever a relation leaves PENDING/VERIFIED. */
const NO_VERIFICATION = {
  sourceDocumentId: null,
  sourceRevisionId: null,
  requestedById: null,
  requestedAt: null,
  verifiedById: null,
  verifiedAt: null,
  verifiedSpecHash: null,
  verifiedGlobalVersion: null,
} as const;

/** The product's current specification fingerprint (xref-rules.ts). */
export async function currentSpecHash(db: AnyDb, productId: string): Promise<string> {
  const values = await db.productSpecValue.findMany({
    where: { productId },
    include: { definition: { select: { key: true } } },
  });
  return specFingerprint(values.map((v) => ({ ...v, key: v.definition.key })));
}

export function factsOf(
  row: Pick<
    XrefRow,
    "status" | "verifiedSpecHash" | "verifiedGlobalVersion" | "globalProduct" | "sourceRevision"
  >,
  specHash: string,
): VerificationFacts {
  return {
    status: row.status,
    sourceRevisionActive: row.sourceRevision ? row.sourceRevision.isActive : null,
    sourceDocumentActive: row.sourceRevision
      ? row.sourceRevision.document.status === "ACTIVE"
      : null,
    verifiedSpecHash: row.verifiedSpecHash,
    currentSpecHash: specHash,
    verifiedGlobalVersion: row.verifiedGlobalVersion,
    globalVersion: row.globalProduct.version,
    globalActive:
      row.globalProduct.status === "ACTIVE" && row.globalProduct.brand.status === "ACTIVE",
  };
}

const withUser = (ids: readonly string[], userId: string) =>
  ids.includes(userId) ? [...ids] : [...ids, userId];

@Injectable()
export class CrossReferencesService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** Platform rows plus the site rows of every site the caller may read products on. */
  private static db(a: StaffAccess): Db {
    return a.db({ siteIds: a.sitesWith(READ), includePlatform: true });
  }

  private static blocked(a: StaffAccess, row: XrefRow): "no_permission" | "own_change" | null {
    if (!a.allows(APPROVE, PLATFORM)) return "no_permission";
    if (row.requestedById === a.userId || row.editorIds.includes(a.userId)) return "own_change";
    return null;
  }

  private async toItem(
    a: StaffAccess,
    row: XrefRow,
    specHash: string,
    live: Set<string>,
  ): Promise<ProductCrossReference> {
    const facts = factsOf(row, specHash);
    const enabled = new Set(row.sites.map((s) => s.siteId));
    const readable = a.sitesWith(READ);
    const sites: CrossReferenceSite[] = a.sites
      .filter((s) => readable.includes(s.id))
      .map((s) => ({
        siteId: s.id,
        siteKey: s.key,
        enabled: enabled.has(s.id),
        ...crossReferenceSiteState({
          facts,
          enabled: enabled.has(s.id),
          productLive: live.has(s.id),
        }),
        canPublish: a.allows(PUBLISH, { scope: "site", siteId: s.id }),
      }));
    const blocked =
      row.status === "PENDING_VERIFICATION" ? CrossReferencesService.blocked(a, row) : null;
    const src = row.sourceRevision;
    return {
      id: row.id,
      productId: row.productId,
      globalProduct: toGlobalProduct(row.globalProduct),
      status: row.status,
      description: row.description,
      comparison: row.comparison,
      version: row.version,
      verification: {
        state: verificationState(facts),
        staleReasons: staleReasons(facts),
        source: src
          ? {
              documentId: src.document.id,
              documentTitle: src.document.title,
              documentType: src.document.type,
              revisionId: src.id,
              revisionNumber: src.revisionNumber,
              isActiveRevision: src.isActive,
            }
          : null,
        requestedBy: userRef(row.requestedBy),
        requestedAt: row.requestedAt?.toISOString() ?? null,
        verifiedBy: userRef(row.verifiedBy),
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
      },
      canVerify: row.status === "PENDING_VERIFICATION" && blocked === null,
      verifyBlockedReason: blocked,
      sites,
      events: row.events.map((e) => ({
        id: e.id,
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        version: e.version,
        actor: userRef(e.actor)!,
        comment: e.comment,
        sourceRevisionId: e.sourceRevisionId,
        createdAt: e.createdAt.toISOString(),
      })),
      removedAt: row.removedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async load(a: StaffAccess, id: string): Promise<ProductCrossReference> {
    const db = CrossReferencesService.db(a);
    const row = (await db.productCrossReference.findUnique({
      where: { id },
      include: XREF_INCLUDE,
    })) as XrefRow | null;
    if (!row) throw new ApiError("NOT_FOUND");
    const live = await liveSites(db, row.productId, a.sitesWith(READ));
    return this.toItem(a, row, await currentSpecHash(db, row.productId), live);
  }

  async list(
    ctx: RequestContext,
    rawProductId: string,
  ): Promise<ProductCrossReferenceListResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await requireMasterRead(a, { type: "product", id: productId });
    const db = CrossReferencesService.db(a);
    if (!(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
      throw new ApiError("NOT_FOUND");
    }
    const rows = (await db.productCrossReference.findMany({
      where: { productId },
      include: XREF_INCLUDE,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: XREFS_PER_PRODUCT_MAX,
    })) as XrefRow[];
    const specHash = await currentSpecHash(db, productId);
    const live = await liveSites(db, productId, a.sitesWith(READ));
    const items: ProductCrossReference[] = [];
    for (const row of rows) items.push(await this.toItem(a, row, specHash, live));
    return { items, canEdit: a.allows(MASTER, PLATFORM), canApprove: a.allows(APPROVE, PLATFORM) };
  }

  private static async event(
    a: StaffAccess,
    tx: ScopedTx,
    input: {
      id: string;
      productId: string;
      action: CrossReferenceAction;
      from: CrossReferenceStatus | null;
      to: CrossReferenceStatus;
      version: number;
      comment?: string | null;
      sourceRevisionId?: string | null;
      permission: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.productCrossReferenceEvent.create({
      data: {
        crossReferenceId: input.id,
        action: input.action,
        fromStatus: input.from,
        toStatus: input.to,
        version: input.version,
        actorUserId: a.userId,
        comment: input.comment ?? null,
        sourceRevisionId: input.sourceRevisionId ?? null,
      },
    });
    await a.audit(tx, {
      action: `catalog.cross_reference_${input.action.toLowerCase()}`,
      resourceType: RESOURCE,
      resourceId: input.id,
      siteId: null,
      permission: input.permission,
      metadata: {
        productId: input.productId,
        from: input.from,
        to: input.to,
        version: input.version,
        ...(input.sourceRevisionId ? { sourceRevisionId: input.sourceRevisionId } : {}),
        ...input.metadata,
      },
    });
  }

  async create(
    ctx: RequestContext,
    rawProductId: string,
    body: unknown,
  ): Promise<{ crossReference: ProductCrossReference }> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await a.require(MASTER, PLATFORM, { type: RESOURCE, id: null });
    const input = parseBody(CrossReferenceCreateRequestSchema, body);
    const db = CrossReferencesService.db(a);
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
        const global = await tx.globalProduct.findUnique({
          where: { id: input.globalProductId },
          select: { status: true, brand: { select: { status: true } } },
        });
        if (!global) {
          throw new ApiError("VALIDATION_FAILED", [{ path: "globalProductId", rule: "unknown" }]);
        }
        if (global.status === "ARCHIVED" || global.brand.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
        }
        const count = await tx.productCrossReference.count({ where: { productId } });
        if (count >= XREFS_PER_PRODUCT_MAX) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "too_many_xrefs" }]);
        }
        const created = await tx.productCrossReference.create({
          data: {
            productId,
            globalProductId: input.globalProductId,
            description: input.description,
            comparison: input.comparison,
            editorIds: [a.userId],
          },
        });
        await CrossReferencesService.event(a, tx, {
          id: created.id,
          productId,
          action: "CREATED",
          from: null,
          to: "SIMILAR",
          version: created.version,
          permission: MASTER,
          metadata: { globalProductId: input.globalProductId },
        });
        return created.id;
      });
    } catch (e) {
      mapDbError(e);
    }
    return { crossReference: await this.load(a, id) };
  }

  /**
   * Runs one transition: loads the row (404), checks the version, lets `apply` decide the change,
   * writes it with an optimistic version guard, then the history and audit events.
   */
  private async transition(
    a: StaffAccess,
    id: string,
    version: number,
    apply: (
      row: XrefRow,
      tx: ScopedTx,
    ) => Promise<{
      action: CrossReferenceAction;
      data: Record<string, unknown>;
      to: CrossReferenceStatus;
      comment?: string | null;
      sourceRevisionId?: string | null;
      permission: string;
      metadata?: Record<string, unknown>;
    } | null>,
  ): Promise<{ crossReference: ProductCrossReference }> {
    const db = CrossReferencesService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const row = (await tx.productCrossReference.findUnique({
          where: { id },
          include: XREF_INCLUDE,
        })) as XrefRow | null;
        if (!row) throw new ApiError("NOT_FOUND");
        if (row.version !== version) throw staleVersion();
        const change = await apply(row, tx);
        if (!change) return;
        const res = await tx.productCrossReference.updateMany({
          where: { id, version },
          data: { ...change.data, status: change.to, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await CrossReferencesService.event(a, tx, {
          id,
          productId: row.productId,
          action: change.action,
          from: row.status,
          to: change.to,
          version: version + 1,
          comment: change.comment ?? null,
          sourceRevisionId: change.sourceRevisionId ?? null,
          permission: change.permission,
          metadata: change.metadata,
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { crossReference: await this.load(a, id) };
  }

  async update(ctx: RequestContext, rawId: string, body: unknown) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: RESOURCE, id });
    const input = parseBody(CrossReferenceUpdateRequestSchema, body);
    return this.transition(a, id, input.version, async (row) => {
      if (row.status === "REMOVED") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "removed" }]);
      }
      const changed = (["description", "comparison"] as const).filter((k) => row[k] !== input[k]);
      if (changed.length === 0) return null;
      // A changed relation is SIMILAR again: a request or a verification no longer applies.
      const reset = row.status !== "SIMILAR";
      return {
        action: reset ? "VERIFICATION_RESET" : "UPDATED",
        to: "SIMILAR",
        data: {
          description: input.description,
          comparison: input.comparison,
          editorIds: withUser(reset ? [] : row.editorIds, a.userId),
          ...(reset ? NO_VERIFICATION : {}),
        },
        permission: MASTER,
        metadata: { changed },
      };
    });
  }

  async requestVerification(ctx: RequestContext, rawId: string, body: unknown) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: RESOURCE, id });
    const input = parseBody(CrossReferenceRequestVerificationSchema, body);
    return this.transition(a, id, input.version, async (row, tx) => {
      if (row.status !== "SIMILAR" && row.status !== "VERIFIED") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
      }
      if (!row.comparison) {
        throw new ApiError("CONFLICT_STATE", [{ path: "comparison", rule: "required" }]);
      }
      const rev = await tx.productDocumentRevision.findUnique({
        where: { id: input.sourceRevisionId },
        select: {
          id: true,
          isActive: true,
          documentId: true,
          document: { select: { productId: true, status: true } },
        },
      });
      // Evidence must be a document of this very product: anything else looks unknown.
      if (!rev || rev.document.productId !== row.productId) {
        throw new ApiError("VALIDATION_FAILED", [{ path: "sourceRevisionId", rule: "unknown" }]);
      }
      if (!rev.isActive || rev.document.status !== "ACTIVE") {
        throw new ApiError("CONFLICT_STATE", [{ path: "sourceRevisionId", rule: "not_active" }]);
      }
      if (row.globalProduct.status !== "ACTIVE" || row.globalProduct.brand.status !== "ACTIVE") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
      }
      return {
        action: "VERIFICATION_REQUESTED",
        to: "PENDING_VERIFICATION",
        data: {
          ...NO_VERIFICATION,
          sourceDocumentId: rev.documentId,
          sourceRevisionId: rev.id,
          requestedById: a.userId,
          requestedAt: new Date(),
          editorIds: withUser(row.editorIds, a.userId),
        },
        comment: input.comment,
        sourceRevisionId: rev.id,
        permission: MASTER,
      };
    });
  }

  /** Verify (APPROVED) or reject a pending request: product:approve, never one's own request. */
  async decide(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    decision: "VERIFIED" | "REJECTED",
  ) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(APPROVE, PLATFORM, { type: RESOURCE, id });
    const input =
      decision === "VERIFIED"
        ? parseBody(CrossReferenceVerifyRequestSchema, body)
        : parseBody(CrossReferenceReasonRequestSchema, body);
    // Separation of duties is checked before the transaction, so the refusal is audited.
    const db = CrossReferencesService.db(a);
    const pre = await db.productCrossReference.findUnique({
      where: { id },
      select: { requestedById: true, editorIds: true, status: true },
    });
    if (!pre) throw new ApiError("NOT_FOUND");
    if (
      pre.status === "PENDING_VERIFICATION" &&
      (pre.requestedById === a.userId || pre.editorIds.includes(a.userId))
    ) {
      await a.denied(APPROVE, { type: RESOURCE, id }, "separation_of_duties");
      throw new ApiError("FORBIDDEN", [{ path: "(root)", rule: "own_change" }]);
    }
    return this.transition(a, id, input.version, async (row, tx) => {
      if (row.status !== "PENDING_VERIFICATION") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_pending" }]);
      }
      if (decision === "REJECTED") {
        return {
          action: "VERIFICATION_REJECTED",
          to: "SIMILAR",
          data: { ...NO_VERIFICATION, editorIds: [] },
          comment: input.comment,
          sourceRevisionId: row.sourceRevisionId,
          permission: APPROVE,
        };
      }
      const src = row.sourceRevision;
      if (!src || !src.isActive || src.document.status !== "ACTIVE") {
        throw new ApiError("CONFLICT_STATE", [{ path: "sourceRevisionId", rule: "not_active" }]);
      }
      if (row.globalProduct.status !== "ACTIVE" || row.globalProduct.brand.status !== "ACTIVE") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
      }
      const specHash = await currentSpecHash(tx, row.productId);
      return {
        action: "VERIFIED",
        to: "VERIFIED",
        data: {
          verifiedById: a.userId,
          verifiedAt: new Date(),
          verifiedSpecHash: specHash,
          verifiedGlobalVersion: row.globalProduct.version,
          editorIds: [],
        },
        comment: input.comment,
        sourceRevisionId: row.sourceRevisionId,
        permission: APPROVE,
        metadata: {
          globalProductId: row.globalProductId,
          globalProductVersion: row.globalProduct.version,
          specFingerprint: specHash,
          requestedById: row.requestedById,
        },
      };
    });
  }

  /** Back to SIMILAR from a pending request (withdraw) or a verification (revoke), with reason. */
  async markSimilar(ctx: RequestContext, rawId: string, body: unknown) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const permission = a.allows(MASTER, PLATFORM) ? MASTER : APPROVE;
    await a.require(permission, PLATFORM, { type: RESOURCE, id });
    const input = parseBody(CrossReferenceReasonRequestSchema, body);
    return this.transition(a, id, input.version, async (row) => {
      if (row.status !== "PENDING_VERIFICATION" && row.status !== "VERIFIED") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
      }
      return {
        action: "MARKED_SIMILAR",
        to: "SIMILAR",
        data: { ...NO_VERIFICATION, editorIds: [] },
        comment: input.comment,
        sourceRevisionId: row.sourceRevisionId,
        permission,
      };
    });
  }

  async remove(ctx: RequestContext, rawId: string, body: unknown) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: RESOURCE, id });
    const input = parseBody(CrossReferenceReasonRequestSchema, body);
    return this.transition(a, id, input.version, async (row, tx) => {
      if (row.status === "REMOVED") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
      }
      // Off every site at once; a restored relation is shown again only by a publisher.
      const hidden = await tx.productCrossReferenceSite.deleteMany({
        where: { crossReferenceId: id },
      });
      return {
        action: "REMOVED",
        to: "REMOVED",
        data: { ...NO_VERIFICATION, removedAt: new Date(), editorIds: [] },
        comment: input.comment,
        permission: MASTER,
        metadata: { sitesHidden: hidden.count },
      };
    });
  }

  async restore(ctx: RequestContext, rawId: string, body: unknown) {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: RESOURCE, id });
    const { version } = parseBody(CrossReferenceStateRequestSchema, body);
    return this.transition(a, id, version, async (row) => {
      if (row.status !== "REMOVED") {
        throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
      }
      return {
        action: "RESTORED",
        to: "SIMILAR",
        data: { removedAt: null, editorIds: [a.userId] },
        permission: MASTER,
      };
    });
  }

  /** Shows or hides a cross-reference on one site: that site's publication decision. */
  async setSite(
    ctx: RequestContext,
    rawId: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<{ crossReference: ProductCrossReference }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const siteId = /^[0-9a-f-]{36}$/i.test(rawSiteId)
      ? rawSiteId.toLowerCase()
      : "00000000-0000-0000-0000-000000000000";
    await a.require(PUBLISH, { scope: "site", siteId }, { type: RESOURCE, id });
    const { visible, version, acknowledgement } = parseBody(CrossReferenceSiteRequestSchema, body);
    const siteDb = a.db({ siteIds: [siteId], includePlatform: true });
    try {
      await siteDb.$transaction(async (tx) => {
        const row = (await tx.productCrossReference.findUnique({
          where: { id },
          include: XREF_INCLUDE,
        })) as XrefRow | null;
        if (!row) throw new ApiError("NOT_FOUND");
        // The publisher decides on what they saw.
        if (row.version !== version) throw staleVersion();
        const existing = await tx.productCrossReferenceSite.findFirst({
          where: { crossReferenceId: id, siteId },
          select: { id: true },
        });
        if (visible === (existing !== null)) return;
        const facts = factsOf(row, await currentSpecHash(tx, row.productId));
        if (visible) {
          const state = crossReferenceSiteState({ facts, enabled: true, productLive: true });
          if (state.state === "not_publishable") {
            throw new ApiError("CONFLICT_STATE", [
              { path: "(root)", rule: "xref_not_publishable" },
            ]);
          }
          if (state.state === "verification_stale") {
            throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "verification_stale" }]);
          }
          await tx.productCrossReferenceSite.create({ data: { crossReferenceId: id, siteId } });
          // DP-091: the publisher's responsibility acknowledgement, recorded with user and time
          // in the same transaction as the publication it belongs to.
          await a.audit(tx, {
            action: "catalog.cross_reference_publication_acknowledged",
            resourceType: RESOURCE,
            resourceId: id,
            siteId,
            permission: PUBLISH,
            metadata: {
              productId: row.productId,
              acknowledgementVersion: acknowledgement!.version,
              acknowledgedAt: new Date().toISOString(),
              status: row.status,
            },
          });
        } else {
          await tx.productCrossReferenceSite.deleteMany({
            where: { crossReferenceId: id, siteId },
          });
        }
        await a.audit(tx, {
          action: visible
            ? "catalog.cross_reference_site_shown"
            : "catalog.cross_reference_site_hidden",
          resourceType: RESOURCE,
          resourceId: id,
          siteId,
          permission: PUBLISH,
          metadata: {
            productId: row.productId,
            status: row.status,
            verification: verificationState(facts),
            ...(visible ? { acknowledgementVersion: acknowledgement!.version } : {}),
          },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { crossReference: await this.load(a, id) };
  }
}
