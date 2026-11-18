/**
 * Review, approval and publication of products (PM-3, DP-068). See contracts
 * catalog-workflow.ts for the state machine; the database enforces the same rules again
 * (migration 20261113090100_pm_3_review_publication), so a bug here cannot publish unapproved
 * content or let an editor approve their own change.
 *
 * Authorization:
 *  - read the workflow and the review queue: `product:read` on any site (masters are shared);
 *    publication rows and their history only for the sites the caller may read (site scope);
 *  - submit / withdraw: `product_master:edit` (PLATFORM);
 *  - approve / request changes: `product:approve` platform-wide, and not an editor or the
 *    submitter of the revision (separation of duties, 403 with rule own_change, audited);
 *  - publish / unpublish: `product:publish` of that site only; the other site is unaffected.
 *  - DP-193 (ADR-023) direct publish (`approvalMode: DIRECT`): additionally `product:approve`
 *    platform-wide (the database checks both again); showing a hidden listing in the same step
 *    (`makeVisible`) needs `product:edit` of the site. The master status is never changed.
 *  - DP-198 (R-29): `makeVisible` in the APPROVED mode too (`product:edit` of the site as well):
 *    the listing is shown, the publication written and both audited in ONE transaction, after
 *    the master row is locked, so either all of it is stored or nothing. Publishing again what is
 *    already live (same mode and versions) is refused, so a repeated request publishes once.
 *
 * Every transition names the version it was based on; each writes its history event and audit
 * event in the same transaction.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ApproveRequestSchema,
  CATALOG_CONTENT_LOCALE,
  ProposalReviewDataSchema,
  checkPublication,
  PublishedSnapshotSchema,
  PublishRequestSchema,
  RequestChangesRequestSchema,
  SubmitReviewRequestSchema,
  UnpublishRequestSchema,
  validateProductData,
  WithdrawReviewRequestSchema,
  type Actor,
  type ProductValidation,
  type ProductWorkflowResponse,
  type PublicationMode,
  type PublishedSnapshot,
  type ReviewQueueResponse,
  type SiteProposal,
  type SitePublication,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { listingSeo } from "./listing-seo.js";
import { lockMaster, type ScopedTx } from "./master.js";
import { requireMasterRead, toRule, uuidOr404, valueData } from "./specs.service.js";

const MASTER = "product_master:edit";
const READ = "product:read";
const APPROVE = "product:approve";
const PUBLISH = "product:publish";
const EDIT = "product:edit";
/** DP-173: the BV catalogue preview link (preview.service.ts). */
const PREVIEW = "product_proposal:review";
/** DP-193: the history note of a direct publication (append-only, shown in the console). */
export const DIRECT_PUBLICATION_NOTE =
  "Direct publication: published without a second-person technical review (DP-193).";
const PLATFORM = { scope: "platform" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = SiteScopedClient | ScopedTx;
type ReviewBlock = "no_permission" | "not_in_review" | "own_change" | "archived";

interface UserRef {
  id: string;
  displayName: string | null;
}
const USER = { select: { id: true, displayName: true } } as const;
const actor = (u: UserRef): Actor => ({ id: u.id, name: u.displayName ?? "Staff user" });
const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface ImageRef {
  id: string;
  productId: string;
  altText: string | null;
  isCover: boolean;
  sortOrder: number;
  variants: unknown;
}

/** The validation engine's input for a set of products (one round trip per table). */
async function loadContent(db: Db, productIds: readonly string[]) {
  const [defs, values, images] = await Promise.all([
    db.specDefinition.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.productSpecValue.findMany({ where: { productId: { in: [...productIds] } } }),
    // DP-166: only the images shown to visitors take part in validation and publication; hidden
    // ones stay in the admin and never enter a snapshot or its imageIds.
    db.productImage.findMany({
      where: { productId: { in: [...productIds] }, isPublic: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        productId: true,
        altText: true,
        isCover: true,
        sortOrder: true,
        variants: true,
      },
    }),
  ]);
  const rules = defs.map(toRule);
  const of = (productId: string) => {
    const v = values.filter((x) => x.productId === productId);
    const imgs: ImageRef[] = images.filter((i) => i.productId === productId);
    const validation: ProductValidation = validateProductData({
      definitions: rules,
      values: v.map((x) => ({
        definitionId: x.definitionId,
        basis: x.basis,
        value: valueData(x),
        unit: x.unit,
        testMethod: x.testMethod,
      })),
      images: imgs,
    });
    return { values: v, images: imgs, validation };
  };
  return { defs, of };
}

/** Separation of duties: who may not decide on the current revision. */
function reviewBlock(
  a: StaffAccess,
  p: { status: string; submittedById: string | null; revisionEditorIds: string[] },
): ReviewBlock | null {
  if (!a.allows(APPROVE, PLATFORM)) return "no_permission";
  if (p.status === "ARCHIVED") return "archived";
  if (p.status !== "IN_REVIEW") return "not_in_review";
  if (p.submittedById === a.userId || p.revisionEditorIds.includes(a.userId)) return "own_change";
  return null;
}

const blockingDetails = (v: { blocking: { target: string; code: string }[] }) =>
  v.blocking.slice(0, 50).map((i) => ({ path: i.target, rule: i.code }));

/** DP-193: the research proposals (DP-171) of one product on the given sites, by site. */
async function loadProposals(
  db: Db,
  productId: string,
  siteIds: readonly string[],
): Promise<Map<string, SiteProposal>> {
  if (siteIds.length === 0) return new Map();
  const rows = await db.productContentProposal.findMany({
    where: { productId, siteId: { in: [...siteIds] }, locale: CATALOG_CONTENT_LOCALE },
    select: {
      id: true,
      siteId: true,
      status: true,
      version: true,
      proposedSummary: true,
      proposedDescription: true,
      reviewData: true,
    },
  });
  return new Map(
    rows.map((r) => {
      const review = ProposalReviewDataSchema.safeParse(r.reviewData);
      // Only the claim-risk notes: held technical values (DP-002) never leave the company review.
      const claimRisks = review.success
        ? review.data.items
            .filter((i) => i.kind === "CLAIM_RISK")
            .map((i) => i.text)
            .slice(0, 50)
        : [];
      return [
        r.siteId,
        {
          id: r.id,
          status: r.status,
          version: r.version,
          summary: r.proposedSummary,
          description: r.proposedDescription,
          claimRisks,
        },
      ];
    }),
  );
}

@Injectable()
export class WorkflowService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  // --- reading ---------------------------------------------------------------------------------

  async workflow(ctx: RequestContext, rawId: string): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await requireMasterRead(a, { type: "product", id });
    const readable = a.sitesWith(READ);
    const db = a.db({ siteIds: readable, includePlatform: true });
    const product = await db.product.findUnique({
      where: { id },
      include: { submittedBy: USER, approvedBy: USER },
    });
    if (!product) throw new ApiError("NOT_FOUND");
    const [content, listings, publications, history, proposals] = await Promise.all([
      loadContent(db, [id]),
      db.productSiteListing.findMany({
        where: { productId: id },
        select: {
          siteId: true,
          version: true,
          visibility: true,
          texts: {
            where: { locale: CATALOG_CONTENT_LOCALE },
            select: { title: true, summary: true, description: true },
          },
        },
      }),
      db.productPublication.findMany({
        where: { productId: id },
        include: { publishedBy: USER, unpublishedBy: USER },
      }),
      db.productReviewEvent.findMany({
        where: { productId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        include: { actor: USER },
      }),
      loadProposals(db, id, readable),
    ]);
    const { validation, images } = content.of(id);
    const approvesPlatform = a.allows(APPROVE, PLATFORM);
    const block = reviewBlock(a, product);
    const sites: SitePublication[] = a.sites
      .filter((s) => readable.includes(s.id))
      .map((s) => {
        const l = listings.find((x) => x.siteId === s.id) ?? null;
        const p = publications.find((x) => x.siteId === s.id) ?? null;
        const site = { scope: "site", siteId: s.id } as const;
        const canPublish = a.allows(PUBLISH, site);
        // DP-193: the console publishes directly when the caller may and the master is not
        // APPROVED; an APPROVED master keeps the PM-3 path.
        const publishMode: PublicationMode =
          canPublish && approvesPlatform && product.status !== "APPROVED" ? "DIRECT" : "APPROVED";
        // DP-198: either mode may show a hidden listing in the publishing transaction.
        const canShowListing = canPublish && a.allows(EDIT, site);
        const proposal = proposals.get(s.id) ?? null;
        return {
          siteId: s.id,
          siteKey: s.key,
          siteName: s.name,
          canPublish,
          listing: l ? { version: l.version, visibility: l.visibility } : null,
          publication: p
            ? {
                id: p.id,
                status: p.status,
                productVersion: p.productVersion,
                listingVersion: p.listingVersion,
                publishedAt: p.publishedAt.toISOString(),
                publishedBy: actor(p.publishedBy),
                unpublishedAt: iso(p.unpublishedAt),
                unpublishedBy: p.unpublishedBy ? actor(p.unpublishedBy) : null,
                approvalMode: p.approvalMode,
                version: p.version,
              }
            : null,
          outdated: {
            master: p !== null && p.productVersion !== product.version,
            listing: p !== null && l !== null && p.listingVersion !== l.version,
          },
          publishMode,
          canShowListing,
          // DP-204: the reviewer or the site's publisher (BV only: only web-bv has the preview).
          canPreview: s.key === "BV" && (a.allows(PREVIEW, site) || canPublish),
          proposal,
          readiness: checkPublication({
            product,
            listing: l ? { visibility: l.visibility, text: l.texts[0] ?? null } : null,
            validation,
            images,
            mode: publishMode,
            canShowListing,
            proposal,
          }),
        };
      });
    return {
      productId: id,
      status: product.status,
      version: product.version,
      submittedAt: iso(product.submittedAt),
      submittedBy: product.submittedBy ? actor(product.submittedBy) : null,
      submittedVersion: product.submittedVersion,
      approvedAt: iso(product.approvedAt),
      approvedBy: product.approvedBy ? actor(product.approvedBy) : null,
      approvedVersion: product.approvedVersion,
      permissions: {
        canSubmit: a.allows(MASTER, PLATFORM) && product.status === "DRAFT",
        canWithdraw: a.allows(MASTER, PLATFORM) && product.status === "IN_REVIEW",
        canReview: block === null,
        reviewBlockedReason: block,
      },
      validation,
      history: history.map((e) => ({
        id: e.id,
        action: e.action,
        siteId: e.siteId,
        productVersion: e.productVersion,
        actor: actor(e.actor),
        comment: e.comment,
        createdAt: e.createdAt.toISOString(),
      })),
      sites,
    };
  }

  /** Masters waiting for a review decision, oldest submission first. */
  async queue(ctx: RequestContext): Promise<ReviewQueueResponse> {
    const a = await this.access.begin(ctx);
    await requireMasterRead(a, { type: "product", id: null });
    const db = a.db({ siteIds: [], includePlatform: true });
    const where = { status: "IN_REVIEW" as const };
    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        take: 100,
        include: { submittedBy: USER },
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const [content, submissions] = await Promise.all([
      loadContent(db, ids),
      ids.length
        ? db.productReviewEvent.findMany({
            where: { productId: { in: ids }, action: "SUBMITTED" },
            orderBy: { createdAt: "desc" },
            select: { productId: true, productVersion: true, comment: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      total,
      canApprove: a.allows(APPROVE, PLATFORM),
      items: rows.map((r) => {
        const { validation } = content.of(r.id);
        const block = reviewBlock(a, r);
        const note = submissions.find(
          (s) => s.productId === r.id && s.productVersion === r.submittedVersion,
        );
        return {
          productId: r.id,
          code: r.code,
          name: r.name,
          version: r.version,
          submittedAt: (r.submittedAt ?? r.updatedAt).toISOString(),
          submittedBy: r.submittedBy ? actor(r.submittedBy) : null,
          comment: note?.comment ?? null,
          blockingCount: validation.blocking.length,
          warningCount: validation.warnings.length,
          canReview: block === null,
          reviewBlockedReason: block,
        };
      }),
    };
  }

  // --- master transitions ------------------------------------------------------------------------

  /** Why a guarded update matched no row: unknown, stale, or not in the expected state. */
  private static async explainMiss(
    tx: ScopedTx,
    id: string,
    version: number,
    expected: string,
  ): Promise<never> {
    const row = await tx.product.findUnique({
      where: { id },
      select: { status: true, version: true },
    });
    if (!row) throw new ApiError("NOT_FOUND");
    if (row.version !== version) throw staleVersion();
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: expected }]);
  }

  async submit(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product", id });
    const { version, comment } = parseBody(SubmitReviewRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      await db.$transaction(async (tx) => {
        const { validation } = (await loadContent(tx, [id])).of(id);
        const now = new Date();
        const res = await tx.product.updateMany({
          where: { id, version, status: "DRAFT" },
          data: {
            status: "IN_REVIEW",
            version: { increment: 1 },
            submittedAt: now,
            submittedById: a.userId,
            submittedVersion: version + 1,
          },
        });
        if (res.count !== 1) await WorkflowService.explainMiss(tx, id, version, "not_draft");
        // Checked after the guarded update (the row is locked now): a master with BLOCKING
        // issues cannot go to review; the transaction rolls back.
        if (!validation.ok) throw new ApiError("VALIDATION_FAILED", blockingDetails(validation));
        await tx.productReviewEvent.create({
          data: {
            productId: id,
            siteId: null,
            action: "SUBMITTED",
            productVersion: version + 1,
            actorUserId: a.userId,
            comment,
          },
        });
        await a.audit(tx, {
          action: "catalog.product_submitted",
          resourceType: "product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { version: version + 1, warnings: validation.warnings.length },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.workflow(ctx, id);
  }

  async withdraw(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product", id });
    const { version } = parseBody(WithdrawReviewRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      await db.$transaction(async (tx) => {
        const res = await tx.product.updateMany({
          where: { id, version, status: "IN_REVIEW" },
          data: { status: "DRAFT", version: { increment: 1 } },
        });
        if (res.count !== 1) await WorkflowService.explainMiss(tx, id, version, "not_in_review");
        await tx.productReviewEvent.create({
          data: {
            productId: id,
            siteId: null,
            action: "WITHDRAWN",
            productVersion: version + 1,
            actorUserId: a.userId,
          },
        });
        await a.audit(tx, {
          action: "catalog.product_review_withdrawn",
          resourceType: "product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { version: version + 1 },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.workflow(ctx, id);
  }

  /** Approve or request changes: same permission and separation-of-duties rule. */
  async decide(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    decision: "APPROVED" | "CHANGES_REQUESTED",
  ): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(APPROVE, PLATFORM, { type: "product", id });
    const { version, comment } =
      decision === "APPROVED"
        ? parseBody(ApproveRequestSchema, body)
        : parseBody(RequestChangesRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    const current = await db.product.findUnique({
      where: { id },
      select: { status: true, version: true, submittedById: true, revisionEditorIds: true },
    });
    if (!current) throw new ApiError("NOT_FOUND");
    if (current.version !== version) throw staleVersion();
    const block = reviewBlock(a, current);
    if (block === "own_change") {
      await a.denied(APPROVE, { type: "product", id }, "separation_of_duties");
      throw new ApiError("FORBIDDEN", [{ path: "(root)", rule: "own_change" }]);
    }
    if (block) throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: block }]);
    try {
      await db.$transaction(async (tx) => {
        if (decision === "APPROVED") {
          const { validation } = (await loadContent(tx, [id])).of(id);
          if (!validation.ok) {
            throw new ApiError("VALIDATION_FAILED", blockingDetails(validation));
          }
        }
        // The event first: its trigger checks separation of duties against the master as it is
        // (submitter and revision editors) before the status changes.
        await tx.productReviewEvent.create({
          data: {
            productId: id,
            siteId: null,
            action: decision,
            productVersion: version + 1,
            actorUserId: a.userId,
            comment,
          },
        });
        const now = new Date();
        const res = await tx.product.updateMany({
          where: { id, version, status: "IN_REVIEW" },
          data:
            decision === "APPROVED"
              ? {
                  status: "APPROVED",
                  version: { increment: 1 },
                  approvedAt: now,
                  approvedById: a.userId,
                  approvedVersion: version + 1,
                }
              : { status: "DRAFT", version: { increment: 1 } },
        });
        if (res.count !== 1) await WorkflowService.explainMiss(tx, id, version, "not_in_review");
        await a.audit(tx, {
          action:
            decision === "APPROVED"
              ? "catalog.product_approved"
              : "catalog.product_changes_requested",
          resourceType: "product",
          resourceId: id,
          siteId: null,
          permission: APPROVE,
          metadata: { version: version + 1, withComment: comment !== null },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.workflow(ctx, id);
  }

  // --- publication -------------------------------------------------------------------------------

  private static async requireSite(
    a: StaffAccess,
    rawSiteId: string,
    productId: string,
  ): Promise<string> {
    const siteId = UUID.test(rawSiteId)
      ? rawSiteId.toLowerCase()
      : "00000000-0000-0000-0000-000000000000";
    await a.require(
      PUBLISH,
      { scope: "site", siteId },
      { type: "product_publication", id: productId },
    );
    return siteId;
  }

  async publish(
    ctx: RequestContext,
    rawId: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const siteId = await WorkflowService.requireSite(a, rawSiteId, id);
    const { version, listingVersion, approvalMode, makeVisible } = parseBody(
      PublishRequestSchema,
      body,
    );
    const direct = approvalMode === "DIRECT";
    if (direct) {
      // DP-193: publishing without a review needs the approver's right too (audited when
      // refused); the database checks both rights again.
      await a.require(APPROVE, PLATFORM, { type: "product_publication", id });
    }
    if (makeVisible) {
      // DP-193 / DP-198: showing the listing is a listing change (audited when refused).
      await a.require(EDIT, { scope: "site", siteId }, { type: "product_listing", id });
    }
    const db = a.db({ siteIds: [siteId], includePlatform: true });
    try {
      await db.$transaction(async (tx) => {
        // DP-193 / DP-198: every publication locks the master first (a no-op UPDATE that keeps
        // the version and the approval), so a concurrent edit, review decision or second
        // publication of this product waits and then sees this one's result: the snapshot is
        // exactly the version checked here, and a repeated request finds the live publication.
        if (!(await lockMaster(tx, id))) throw new ApiError("NOT_FOUND");
        const product = await tx.product.findUnique({ where: { id } });
        if (!product) throw new ApiError("NOT_FOUND");
        let listing = await tx.productSiteListing.findUnique({
          where: { productId_siteId: { productId: id, siteId } },
          include: { texts: { where: { locale: CATALOG_CONTENT_LOCALE } } },
        });
        // Read separately: the scoped client refuses to-one includes into site-bound models.
        const category = listing
          ? await tx.productCategory.findUnique({
              where: { id: listing.categoryId },
              select: { slug: true, name: true },
            })
          : null;
        if (product.version !== version) throw staleVersion();
        if (listing && listing.version !== listingVersion) {
          throw new ApiError("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }]);
        }
        const [content, proposals] = await Promise.all([
          loadContent(tx, [id]),
          loadProposals(tx, id, [siteId]),
        ]);
        const { validation, images, values } = content.of(id);
        const proposal = proposals.get(siteId) ?? null;
        const text = listing?.texts[0] ?? null;
        const readiness = checkPublication({
          product,
          listing: listing ? { visibility: listing.visibility, text } : null,
          validation,
          images,
          mode: approvalMode,
          canShowListing: makeVisible,
          proposal,
        });
        if (!readiness.ok || !listing || !category) {
          throw new ApiError(
            "CONFLICT_STATE",
            readiness.blocking.slice(0, 50).map((i) => ({ path: i.target, rule: i.code })),
          );
        }
        const existing = await tx.productPublication.findUnique({
          where: { productId_siteId: { productId: id, siteId } },
          select: {
            id: true,
            version: true,
            status: true,
            productVersion: true,
            listingVersion: true,
            approvalMode: true,
          },
        });
        // DP-198: what is live already is not published twice (a repeated or concurrent request).
        if (
          existing?.status === "PUBLISHED" &&
          existing.approvalMode === approvalMode &&
          existing.productVersion === version &&
          existing.listingVersion === listing.version &&
          listing.visibility === "VISIBLE"
        ) {
          throw new ApiError("CONFLICT_STATE", [
            { path: "publication", rule: "already_published" },
          ]);
        }
        // DP-193 / DP-198: show the hidden listing in the same transaction (its own version and
        // audit); a later refusal rolls it back with the publication.
        const listingShown = makeVisible && listing.visibility !== "VISIBLE";
        if (listingShown) {
          const res = await tx.productSiteListing.updateMany({
            where: { id: listing.id, version: listing.version, visibility: "HIDDEN" },
            data: { visibility: "VISIBLE", version: { increment: 1 } },
          });
          if (res.count !== 1) {
            throw new ApiError("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }]);
          }
          listing = { ...listing, visibility: "VISIBLE", version: listing.version + 1 };
          await a.audit(tx, {
            action: "catalog.listing_updated",
            resourceType: "product_listing",
            resourceId: listing.id,
            siteId,
            permission: EDIT,
            metadata: {
              productId: id,
              changed: ["visibility"],
              visibility: "VISIBLE",
              version: listing.version,
              cause: direct ? "direct_publication" : "approved_publication",
            },
          });
        }
        const publishedListingVersion = listing.version;
        const defsById = new Map(content.defs.map((d) => [d.id, d]));
        const snapshot: PublishedSnapshot = PublishedSnapshotSchema.parse({
          schemaVersion: 1,
          slug: product.slug,
          code: product.code,
          name: text?.title ?? product.name,
          summary: text?.summary ?? product.summary,
          description: text?.description ?? product.description,
          category,
          sortOrder: listing.sortOrder,
          specs: values
            .map((v) => ({ v, d: defsById.get(v.definitionId) }))
            .filter((x): x is { v: (typeof values)[number]; d: NonNullable<typeof x.d> } => !!x.d)
            .sort(
              (x, y) =>
                x.d.sortOrder - y.d.sortOrder ||
                x.d.name.localeCompare(y.d.name) ||
                // DP-156: the specification value before the typical value of the same property
                (x.v.basis === y.v.basis ? 0 : x.v.basis === "SPECIFICATION" ? -1 : 1),
            )
            .map(({ v, d }) => ({
              key: d.key,
              name: d.name,
              basis: v.basis,
              value: valueData(v),
              unit: v.unit,
              testMethod: v.testMethod,
            })),
          images: images.map((i) => {
            const display = (i.variants as { display?: { width?: number; height?: number } })
              ?.display;
            return {
              id: i.id,
              altText: i.altText,
              isCover: i.isCover,
              width: display?.width ?? 0,
              height: display?.height ?? 0,
            };
          }),
          // DP-209: the listing's SEO as published; an OG image no longer among the published
          // images falls back to the cover (never a link to an image the site does not serve).
          seo: ((seo) => ({
            ...seo,
            ogImageId: images.some((i) => i.id === seo.ogImageId) ? seo.ogImageId : null,
          }))(listingSeo(listing)),
        });
        const fields = {
          status: "PUBLISHED" as const,
          productVersion: version,
          listingVersion: publishedListingVersion,
          snapshot,
          imageIds: images.map((i) => i.id),
          publishedAt: new Date(),
          publishedById: a.userId,
          unpublishedAt: null,
          unpublishedById: null,
          approvalMode,
        };
        if (existing) {
          const res = await tx.productPublication.updateMany({
            where: { id: existing.id, version: existing.version },
            data: { ...fields, version: { increment: 1 } },
          });
          if (res.count !== 1) throw staleVersion();
        } else {
          await tx.productPublication.create({
            data: { productId: id, siteId, listingId: listing.id, ...fields },
          });
        }
        await tx.productReviewEvent.create({
          data: {
            productId: id,
            siteId,
            action: "PUBLISHED",
            productVersion: version,
            actorUserId: a.userId,
            ...(direct ? { comment: DIRECT_PUBLICATION_NOTE } : {}),
          },
        });
        const common = {
          productVersion: version,
          listingVersion,
          republished: existing !== null,
          images: fields.imageIds.length,
          warnings: readiness.warnings.length,
        };
        await a.audit(tx, {
          action: direct ? "catalog.product_published_direct" : "catalog.product_published",
          resourceType: "product_publication",
          resourceId: id,
          siteId,
          permission: PUBLISH,
          metadata: direct
            ? {
                ...common,
                listingVersion: publishedListingVersion,
                approvalMode: "DIRECT",
                productStatus: product.status,
                listingShown,
                sensitiveClaims: readiness.warnings.filter((w) => w.code === "sensitive_claim")
                  .length,
                companyReview: proposal?.status ?? null,
              }
            : { ...common, listingVersion: publishedListingVersion, listingShown },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.workflow(ctx, id);
  }

  async unpublish(
    ctx: RequestContext,
    rawId: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<ProductWorkflowResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    const siteId = await WorkflowService.requireSite(a, rawSiteId, id);
    const { version, comment } = parseBody(UnpublishRequestSchema, body);
    const db = a.db({ siteIds: [siteId], includePlatform: true });
    try {
      await db.$transaction(async (tx) => {
        const pub = await tx.productPublication.findUnique({
          where: { productId_siteId: { productId: id, siteId } },
          select: { id: true, version: true, status: true, productVersion: true },
        });
        if (!pub) throw new ApiError("NOT_FOUND");
        if (pub.version !== version) throw staleVersion();
        if (pub.status !== "PUBLISHED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "not_published" }]);
        }
        const res = await tx.productPublication.updateMany({
          where: { id: pub.id, version, status: "PUBLISHED" },
          data: {
            status: "UNPUBLISHED",
            unpublishedAt: new Date(),
            unpublishedById: a.userId,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await tx.productReviewEvent.create({
          data: {
            productId: id,
            siteId,
            action: "UNPUBLISHED",
            productVersion: pub.productVersion,
            actorUserId: a.userId,
            comment,
          },
        });
        await a.audit(tx, {
          action: "catalog.product_unpublished",
          resourceType: "product_publication",
          resourceId: id,
          siteId,
          permission: PUBLISH,
          metadata: { productVersion: pub.productVersion, withComment: comment !== null },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return this.workflow(ctx, id);
  }
}
