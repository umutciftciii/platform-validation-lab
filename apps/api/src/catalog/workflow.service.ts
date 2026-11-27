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
 *
 * ML-8b (ADR-028 D8, DP-257): the publication writes the default language and the languages the
 * publisher names (`locales`, complete ones only, with a confirmed manual claim check where no
 * reviewed word list exists); every other language of the live snapshot is kept as published.
 * The workflow view lists the site's languages with their state (translation-state.ts).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ApproveRequestSchema,
  ProposalReviewDataSchema,
  checkPublication,
  claimScanOf,
  findSensitiveClaims,
  parseStoredSnapshot,
  sortSiteLocales,
  type SiteLanguagePublication,
  type SiteLocale,
  PublishRequestSchema,
  RequestChangesRequestSchema,
  SubmitReviewRequestSchema,
  UnpublishRequestSchema,
  storedSnapshotSlug,
  validateProductData,
  WithdrawReviewRequestSchema,
  type Actor,
  type ProductValidation,
  type ProductWorkflowResponse,
  type PublicationMode,
  type ReviewQueueResponse,
  type SiteProposal,
  type SitePublication,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { lockMaster, type ScopedTx } from "./master.js";
import {
  applyAddressChange,
  keepsOldProductAddress,
  lockSitePaths,
  redirectsTo,
} from "../seo/redirects.js";
import { requireMasterRead, toRule, uuidOr404, valueData } from "./specs.service.js";
import { siteLocalesOf } from "../cms/site-locales.js";
import {
  buildSnapshotV2,
  catalogLocales,
  displaySize,
  LISTING_TEXT_SELECT,
  loadTextRows,
} from "./snapshot.js";
import { loadProductTextRows, localeView } from "./translation-state.js";

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

/** DP-210: a product's address on a public site is `/products/<snapshot slug>`. */
const PRODUCTS_PATH = "/products/";
/** ML-8a: equal JSON values, object key order ignored (jsonb does not keep it). */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** ML-8a: the slug of a v1 or v2 snapshot (language-neutral). */
const snapshotSlug = (snapshot: unknown): string | null => storedSnapshotSlug(snapshot);
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
  /** ML-8a: the language whose proposal gates publication (the site's default language). */
  localeOf: ReadonlyMap<string, string>,
): Promise<Map<string, SiteProposal>> {
  if (siteIds.length === 0) return new Map();
  const all = await db.productContentProposal.findMany({
    where: { productId, siteId: { in: [...siteIds] } },
    select: {
      id: true,
      siteId: true,
      status: true,
      version: true,
      proposedSummary: true,
      proposedDescription: true,
      reviewData: true,
      locale: true,
    },
  });
  const rows = all.filter((r) => r.locale === localeOf.get(r.siteId));
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

/**
 * ML-8b: the enabled languages of a site for the publication view (default first): live or not,
 * the translation state, what blocks the language and the sensitive wording in its next text.
 */
async function siteLanguages(
  db: Db,
  productId: string,
  siteId: string,
  all: readonly SiteLocale[],
): Promise<SiteLanguagePublication[]> {
  const enabled = sortSiteLocales(all.filter((l) => l.enabled));
  const rows = await loadProductTextRows(db, productId, siteId, [...all]);
  if (!rows) return [];
  return enabled.map((l) => {
    const v = localeView(rows, l.locale);
    const own = rows.listing?.texts.find((t) => t.locale === l.locale);
    const src = v.listing?.source;
    const claims = l.isDefault
      ? findSensitiveClaims(src?.title, src?.summary, src?.description)
      : findSensitiveClaims(own?.title, own?.summary, own?.description);
    return {
      locale: l.locale,
      isDefault: l.isDefault,
      public: l.public,
      live: v.live,
      hasText: v.hasText,
      state: v.state,
      requiredMissing: v.requiredMissing.slice(0, 600),
      claims,
      claimScan: claimScanOf(l.locale),
    };
  });
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
    // ML-8a: the default language of each readable site (texts and proposals are read in it).
    const siteLocales = await siteLocalesOf(db, readable);
    const defaults = new Map(
      [...siteLocales].map(([siteId, list]) => [
        siteId,
        list.find((l) => l.isDefault)?.locale ?? "",
      ]),
    );
    const [content, listings, publications, history, proposals] = await Promise.all([
      loadContent(db, [id]),
      db.productSiteListing.findMany({
        where: { productId: id },
        select: {
          siteId: true,
          version: true,
          visibility: true,
          texts: { select: { locale: true, title: true, summary: true, description: true } },
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
      loadProposals(db, id, readable, defaults),
    ]);
    const { validation, images } = content.of(id);
    // DP-210: older addresses of the product per site (BV only; one small read per site).
    const redirects = new Map<string, string[]>();
    for (const s of a.sites) {
      if (readable.includes(s.id) && keepsOldProductAddress(a.sites, s.id)) {
        redirects.set(s.id, await redirectsTo(db, s.id, "PRODUCT", id));
      }
    }
    // ML-8b: the languages of each readable site that has a listing (one small read per site).
    const languages = new Map<string, SiteLanguagePublication[]>();
    for (const l of listings) {
      languages.set(
        l.siteId,
        await siteLanguages(db, id, l.siteId, siteLocales.get(l.siteId) ?? []),
      );
    }
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
                slug: snapshotSlug(p.snapshot),
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
          addresses: {
            live:
              p?.status === "PUBLISHED" && snapshotSlug(p.snapshot) !== null
                ? `${PRODUCTS_PATH}${snapshotSlug(p.snapshot)}`
                : null,
            next: `${PRODUCTS_PATH}${product.slug}`,
            keepsOldAddress: keepsOldProductAddress(a.sites, s.id),
            redirectsHere: redirects.get(s.id) ?? [],
          },
          readiness: checkPublication({
            product,
            listing: l
              ? {
                  visibility: l.visibility,
                  text: l.texts.find((t) => t.locale === defaults.get(s.id)) ?? null,
                }
              : null,
            validation,
            images,
            mode: publishMode,
            canShowListing,
            proposal,
          }),
          languages: languages.get(s.id) ?? [],
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
    const {
      version,
      listingVersion,
      approvalMode,
      makeVisible,
      locales: chosen,
      manualReview,
    } = parseBody(PublishRequestSchema, body);
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
    // ML-8a (ADR-028 D8): one publication writes every enabled language whose listing text is
    // there (the default language always), in this one transaction. Visibility of a language is
    // separate (SiteLocale.public); a language that is not enabled is never written.
    const allLocales = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    const { defaultLocale, locales } = catalogLocales(allLocales);
    // ML-8b: the publisher's languages are other enabled languages of the site.
    for (const l of chosen) {
      if (l === defaultLocale) {
        throw new ApiError("VALIDATION_FAILED", [{ path: "locales", rule: "default_locale" }]);
      }
      if (!locales.includes(l)) {
        throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "not_enabled" }]);
      }
    }
    if (manualReview.some((l) => !chosen.includes(l))) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "manualReview", rule: "not_chosen" }]);
    }
    try {
      await db.$transaction(async (tx) => {
        // DP-193 / DP-198: every publication locks the master first (a no-op UPDATE that keeps
        // the version and the approval), so a concurrent edit, review decision or second
        // publication of this product waits and then sees this one's result: the snapshot is
        // exactly the version checked here, and a repeated request finds the live publication.
        if (!(await lockMaster(tx, id))) throw new ApiError("NOT_FOUND");
        // DP-210: then the site's addresses (always after the master, never before: no cycle).
        await lockSitePaths(tx, siteId);
        const product = await tx.product.findUnique({ where: { id } });
        if (!product) throw new ApiError("NOT_FOUND");
        let listing = await tx.productSiteListing.findUnique({
          where: { productId_siteId: { productId: id, siteId } },
          include: { texts: { select: LISTING_TEXT_SELECT } },
        });
        // Read separately: the scoped client refuses to-one includes into site-bound models.
        const category = listing
          ? await tx.productCategory.findUnique({
              where: { id: listing.categoryId },
              select: { id: true, slug: true },
            })
          : null;
        if (product.version !== version) throw staleVersion();
        if (listing && listing.version !== listingVersion) {
          throw new ApiError("CONFLICT_STATE", [{ path: "listingVersion", rule: "stale" }]);
        }
        const [content, proposals] = await Promise.all([
          loadContent(tx, [id]),
          loadProposals(tx, id, [siteId], new Map([[siteId, defaultLocale]])),
        ]);
        const { validation, images, values } = content.of(id);
        const proposal = proposals.get(siteId) ?? null;
        const text = listing?.texts.find((t) => t.locale === defaultLocale) ?? null;
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
        // ML-8b: a chosen language must be complete, and checked by hand where no reviewed claim
        // word list exists (DP-257).
        if (chosen.length) {
          const rows = await loadProductTextRows(tx, id, siteId, allLocales);
          const missing = chosen.flatMap((l) =>
            rows ? localeView(rows, l).requiredMissing.map((u) => `${l}:${u}`) : [`${l}:listing`],
          );
          if (missing.length) {
            throw new ApiError(
              "CONFLICT_STATE",
              missing.slice(0, 50).map((path) => ({ path, rule: "translation_missing" })),
            );
          }
          const unchecked = chosen.filter(
            (l) => claimScanOf(l) === "MANUAL" && !manualReview.includes(l),
          );
          if (unchecked.length) {
            throw new ApiError(
              "CONFLICT_STATE",
              unchecked.map((path) => ({ path, rule: "manual_review_required" })),
            );
          }
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
            snapshot: true,
          },
        });
        // DP-210: one product per address. Another product published here under this slug (its
        // master moved on, its snapshot did not) keeps the address until it is republished or
        // taken off.
        const taken = await tx.productPublication.findFirst({
          where: {
            siteId,
            status: "PUBLISHED",
            productId: { not: id },
            snapshot: { path: ["slug"], equals: product.slug },
          },
          select: { id: true },
        });
        if (taken) {
          throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "live_elsewhere" }]);
        }
        const previousSlug =
          existing?.status === "PUBLISHED" ? snapshotSlug(existing.snapshot) : null;
        const defsById = new Map(content.defs.map((d) => [d.id, d]));
        const specs = values
          .map((v) => ({ v, d: defsById.get(v.definitionId) }))
          .filter((x): x is { v: (typeof values)[number]; d: NonNullable<typeof x.d> } => !!x.d);
        const textRows = await loadTextRows(tx, {
          categoryIds: [category.id],
          definitionIds: [...new Set(specs.map((x) => x.d.id))],
          imageIds: images.map((i) => i.id),
        });
        // ML-8b: languages not chosen keep the texts of the live snapshot (v2), never a draft.
        const live =
          existing?.status === "PUBLISHED" ? parseStoredSnapshot(existing.snapshot) : null;
        const carry = live?.schemaVersion === 2 ? live.locales : {};
        const snapshot = buildSnapshotV2({
          defaultLocale,
          locales,
          only: chosen,
          carry,
          product,
          listing,
          listingTexts: listing.texts,
          category,
          categoryTexts: textRows.categoryTexts,
          specs: specs.map(({ v, d }) => ({
            definitionId: d.id,
            key: d.key,
            sortOrder: d.sortOrder,
            basis: v.basis,
            value: valueData(v),
            unit: v.unit,
            testMethod: v.testMethod,
          })),
          specTexts: textRows.specTexts,
          images: images.map((i) => ({ id: i.id, isCover: i.isCover, ...displaySize(i.variants) })),
          imageTexts: textRows.imageTexts,
        });
        // DP-198: what is live already is not published twice (a repeated or concurrent request).
        // ML-8a: "already live" also means the same content: a category, specification or alt
        // text (any language) changes no master or listing version, so a publication whose
        // snapshot would differ from the live one is allowed (and a v1 snapshot is replaced).
        if (
          existing?.status === "PUBLISHED" &&
          existing.approvalMode === approvalMode &&
          existing.productVersion === version &&
          existing.listingVersion === listing.version &&
          listing.visibility === "VISIBLE" &&
          sameJson(existing.snapshot, snapshot)
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
          ...(previousSlug !== null && previousSlug !== product.slug ? { slugChanged: true } : {}),
          images: fields.imageIds.length,
          warnings: readiness.warnings.length,
          // ML-8a: the languages the snapshot carries (names only).
          locales: Object.keys(snapshot.locales),
          // ML-8b: written from current texts (default + chosen) and confirmed manual checks.
          writtenLocales: [defaultLocale, ...chosen],
          ...(manualReview.length ? { manualReview } : {}),
        };
        // DP-210: the previous address answers 301 with the new one (BV); older redirects follow.
        if (keepsOldProductAddress(a.sites, siteId)) {
          await applyAddressChange(tx, a, {
            siteId,
            contentType: "PRODUCT",
            contentId: id,
            from: previousSlug === null ? null : `${PRODUCTS_PATH}${previousSlug}`,
            to: `${PRODUCTS_PATH}${product.slug}`,
            permission: PUBLISH,
          });
        }
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
