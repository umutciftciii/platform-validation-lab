/**
 * Content proposals (DP-171, ADR-022): research-drafted listing text for one product on one site
 * and the company's review of it. See contracts catalog-proposals.ts for the state machine; the
 * database enforces the same rules again (migration 20261202090000_dp_171_content_proposals).
 *
 * Authorization:
 *  - read proposals and their history: `product:read` of the proposal's site;
 *  - create / revise: `product:edit` of the site (the writer becomes an author of the revision);
 *  - approve / request changes: `product_proposal:review` of the site, and not an author of the
 *    revision (separation of duties, 403 with rule own_change, audited).
 *
 * This service never writes to a product, its listing or texts, specifications, images,
 * documents or publications. Every change names the version it was based on and writes its
 * history event and audit event in the same transaction.
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  ApproveProposalRequestSchema,
  CreateProposalRequestSchema,
  ProposalReviewDataSchema,
  proposalContentKey,
  ProposalStatusSchema,
  RequestProposalChangesRequestSchema,
  REVIEW_ITEM_KINDS,
  ReviseProposalRequestSchema,
  type ProposalListResponse,
  type ProposalResponse,
  type ProposalStatus,
  type ReviewItemKind,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { uuidOr404 } from "./specs.service.js";

const READ = "product:read";
const EDIT = "product:edit";
const REVIEW = "product_proposal:review";

type DecisionBlock = "no_permission" | "not_in_review" | "own_change";

interface UserRef {
  id: string;
  displayName: string | null;
}
const actor = (u: UserRef) => ({ id: u.id, name: u.displayName ?? "Staff user" });

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const contentSha = (summary: string | null, description: string | null) =>
  sha256(proposalContentKey(summary, description));

const PRODUCT_SELECT = { select: { id: true, code: true, name: true } } as const;

function itemCounts(reviewData: unknown): Record<ReviewItemKind, number> {
  const counts = Object.fromEntries(REVIEW_ITEM_KINDS.map((k) => [k, 0])) as Record<
    ReviewItemKind,
    number
  >;
  const parsed = ProposalReviewDataSchema.safeParse(reviewData);
  if (parsed.success) for (const i of parsed.data.items) counts[i.kind] += 1;
  return counts;
}

function decisionBlock(
  a: StaffAccess,
  p: { siteId: string; status: string; authorIds: string[] | null },
): DecisionBlock | null {
  if (!a.allows(REVIEW, { scope: "site", siteId: p.siteId })) return "no_permission";
  if (p.status !== "REVIEW_PENDING") return "not_in_review";
  if ((p.authorIds ?? []).includes(a.userId)) return "own_change";
  return null;
}

@Injectable()
export class ProposalsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  // --- reading ---------------------------------------------------------------------------------

  async list(
    ctx: RequestContext,
    query: { siteId?: unknown; status?: unknown },
  ): Promise<ProposalListResponse> {
    const a = await this.access.begin(ctx);
    const readable = a.sitesWith(READ);
    let siteIds = readable;
    if (typeof query.siteId === "string" && query.siteId !== "") {
      const siteId = uuidOr404(query.siteId);
      await a.require(READ, { scope: "site", siteId }, { type: "product_proposal", id: null });
      siteIds = [siteId];
    } else if (readable.length === 0) {
      await a.require(READ, { scope: "platform" }, { type: "product_proposal", id: null });
    }
    let status: ProposalStatus | undefined;
    if (typeof query.status === "string" && query.status !== "") {
      const s = ProposalStatusSchema.safeParse(query.status);
      if (!s.success) throw new ApiError("VALIDATION_FAILED", [{ path: "status", rule: "enum" }]);
      status = s.data;
    }
    const db = a.db({ siteIds, includePlatform: false });
    const all = await db.productContentProposal.findMany({
      include: { product: PRODUCT_SELECT },
      orderBy: [{ product: { code: "asc" } }, { locale: "asc" }],
    });
    const counts = { REVIEW_PENDING: 0, CHANGES_REQUESTED: 0, APPROVED: 0 };
    for (const r of all) counts[r.status] += 1;
    const rows = status ? all.filter((r) => r.status === status) : all;
    return {
      proposals: rows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        productId: r.productId,
        productCode: r.product.code,
        productName: r.product.name,
        locale: r.locale,
        status: r.status,
        version: r.version,
        hasText: r.proposedSummary !== null || r.proposedDescription !== null,
        itemCounts: itemCounts(r.reviewData),
        updatedAt: r.updatedAt.toISOString(),
      })),
      counts,
    };
  }

  async get(ctx: RequestContext, rawId: string): Promise<ProposalResponse> {
    const a = await this.access.begin(ctx);
    return this.read(a, uuidOr404(rawId));
  }

  private async read(a: StaffAccess, id: string): Promise<ProposalResponse> {
    const readable = a.sitesWith(READ);
    const db = a.db({ siteIds: readable, includePlatform: false });
    const p = await db.productContentProposal.findUnique({
      where: { id },
      include: {
        product: PRODUCT_SELECT,
        decidedBy: { select: { id: true, displayName: true } },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { actor: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!p) {
      // Outside every readable site: answer like an unknown id, but record the attempt.
      if (readable.length === 0) {
        await a.require(READ, { scope: "platform" }, { type: "product_proposal", id });
      }
      throw new ApiError("NOT_FOUND");
    }
    const authorIds = p.authorIds ?? [];
    const names = await a.staffNames(authorIds);
    const block = decisionBlock(a, p);
    return {
      proposal: {
        id: p.id,
        siteId: p.siteId,
        productId: p.productId,
        productCode: p.product.code,
        productName: p.product.name,
        locale: p.locale,
        summary: p.proposedSummary,
        description: p.proposedDescription,
        reviewData: ProposalReviewDataSchema.parse(p.reviewData),
        sourceRef: p.sourceRef,
        sourceSha256: p.sourceSha256,
        status: p.status,
        version: p.version,
        authors: authorIds.map((uid) => ({ id: uid, name: names.get(uid) ?? "Staff user" })),
        decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
        decidedBy: p.decidedBy ? actor(p.decidedBy) : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      },
      events: p.events.map((e) => ({
        id: e.id,
        action: e.action,
        proposalVersion: e.proposalVersion,
        actor: actor(e.actor),
        comment: e.comment,
        contentSha256: e.contentSha256,
        createdAt: e.createdAt.toISOString(),
      })),
      canRevise: a.allows(EDIT, { scope: "site", siteId: p.siteId }),
      canDecide: block === null,
      decisionBlocked: block,
    };
  }

  // --- writing ---------------------------------------------------------------------------------

  async create(ctx: RequestContext, rawSiteId: string, body: unknown): Promise<ProposalResponse> {
    const a = await this.access.begin(ctx);
    const siteId = uuidOr404(rawSiteId);
    await a.require(EDIT, { scope: "site", siteId }, { type: "product_proposal", id: null });
    const req = parseBody(CreateProposalRequestSchema, body);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const listing = await db.productSiteListing.findUnique({
      where: { productId_siteId: { productId: req.productId, siteId } },
      select: { id: true },
    });
    if (!listing) {
      throw new ApiError("CONFLICT_STATE", [{ path: "productId", rule: "listing_missing" }]);
    }
    let id = "";
    try {
      await db.$transaction(async (tx) => {
        const created = await tx.productContentProposal.create({
          data: {
            productId: req.productId,
            siteId,
            locale: req.locale,
            proposedSummary: req.summary,
            proposedDescription: req.description,
            reviewData: req.reviewData,
            sourceRef: req.sourceRef,
            sourceSha256: req.sourceSha256,
            authorIds: [a.userId],
            createdById: a.userId,
          },
          select: { id: true },
        });
        id = created.id;
        await tx.productContentProposalEvent.create({
          data: {
            proposalId: id,
            siteId,
            action: "CREATED",
            proposalVersion: 1,
            actorUserId: a.userId,
            comment: null,
            contentSha256: contentSha(req.summary, req.description),
          },
        });
        await a.audit(tx, {
          action: "catalog.proposal_created",
          resourceType: "product_proposal",
          resourceId: id,
          siteId,
          permission: EDIT,
          metadata: { productId: req.productId, locale: req.locale, sourceRef: req.sourceRef },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.read(a, id);
  }

  async revise(ctx: RequestContext, rawId: string, body: unknown): Promise<ProposalResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const current = await this.locate(a, id);
    await a.require(
      EDIT,
      { scope: "site", siteId: current.siteId },
      { type: "product_proposal", id },
    );
    const req = parseBody(ReviseProposalRequestSchema, body);
    if (current.version !== req.version) throw staleVersion();
    const db = a.db({ siteIds: [current.siteId], includePlatform: false });
    const authors = current.authorIds ?? [];
    try {
      await db.$transaction(async (tx) => {
        await tx.productContentProposalEvent.create({
          data: {
            proposalId: id,
            siteId: current.siteId,
            action: "REVISED",
            proposalVersion: req.version + 1,
            actorUserId: a.userId,
            comment: req.comment,
            contentSha256: contentSha(req.summary, req.description),
          },
        });
        const res = await tx.productContentProposal.updateMany({
          where: { id, version: req.version },
          data: {
            proposedSummary: req.summary,
            proposedDescription: req.description,
            reviewData: req.reviewData,
            sourceRef: req.sourceRef,
            sourceSha256: req.sourceSha256,
            status: "REVIEW_PENDING",
            version: { increment: 1 },
            authorIds: authors.includes(a.userId) ? authors : [...authors, a.userId],
            decidedAt: null,
            decidedById: null,
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.proposal_revised",
          resourceType: "product_proposal",
          resourceId: id,
          siteId: current.siteId,
          permission: EDIT,
          metadata: { version: req.version + 1, sourceRef: req.sourceRef },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.read(a, id);
  }

  /** Approve or request changes: same permission and separation-of-duties rule. */
  async decide(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    decision: "APPROVED" | "CHANGES_REQUESTED",
  ): Promise<ProposalResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const current = await this.locate(a, id);
    await a.require(
      REVIEW,
      { scope: "site", siteId: current.siteId },
      { type: "product_proposal", id },
    );
    const { version, comment } =
      decision === "APPROVED"
        ? parseBody(ApproveProposalRequestSchema, body)
        : parseBody(RequestProposalChangesRequestSchema, body);
    if (current.version !== version) throw staleVersion();
    const block = decisionBlock(a, current);
    if (block === "own_change") {
      await a.denied(REVIEW, { type: "product_proposal", id }, "separation_of_duties", {
        scope: "site",
        siteId: current.siteId,
      });
      throw new ApiError("FORBIDDEN", [{ path: "(root)", rule: "own_change" }]);
    }
    if (block) throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: block }]);
    const db = a.db({ siteIds: [current.siteId], includePlatform: false });
    try {
      await db.$transaction(async (tx) => {
        // The event first: its trigger checks separation of duties against the proposal as it is.
        await tx.productContentProposalEvent.create({
          data: {
            proposalId: id,
            siteId: current.siteId,
            action: decision,
            proposalVersion: version + 1,
            actorUserId: a.userId,
            comment,
            contentSha256: contentSha(current.proposedSummary, current.proposedDescription),
          },
        });
        const res = await tx.productContentProposal.updateMany({
          where: { id, version, status: "REVIEW_PENDING" },
          data: {
            status: decision,
            version: { increment: 1 },
            decidedAt: new Date(),
            decidedById: a.userId,
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action:
            decision === "APPROVED"
              ? "catalog.proposal_approved"
              : "catalog.proposal_changes_requested",
          resourceType: "product_proposal",
          resourceId: id,
          siteId: current.siteId,
          permission: REVIEW,
          metadata: { version: version + 1, productId: current.productId },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.read(a, id);
  }

  /** The proposal as it is, if the caller may read its site; otherwise 404 like an unknown id. */
  private async locate(a: StaffAccess, id: string) {
    const readable = a.sitesWith(READ);
    const p = await a
      .db({ siteIds: readable, includePlatform: false })
      .productContentProposal.findUnique({
        where: { id },
        select: {
          siteId: true,
          productId: true,
          status: true,
          version: true,
          authorIds: true,
          proposedSummary: true,
          proposedDescription: true,
        },
      });
    if (!p) throw new ApiError("NOT_FOUND");
    return p;
  }
}
