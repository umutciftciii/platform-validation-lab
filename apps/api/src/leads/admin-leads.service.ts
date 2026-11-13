/**
 * Staff read access to leads (DP-042; ADR-016 D8). Leads are customer data (ADR-011 K-02): only
 * `lead:read` on the lead's site opens them: `sales_crm_user` on its site, the platform customer-data
 * officer and the platform super admin on every site (ADR-017 v2), and the system owner (ADR-018).
 * Site admins and other staff are refused (403 with a DENIED audit event). Every list and detail
 * read is audited (`leads.list_viewed`, `leads.lead_viewed`) without personal data in the
 * metadata; the event names the role assignments that allowed the read (`accessAssignmentIds`).
 * DP-041 (ADR-019): the sales workflow. `lead:manage` on the lead's site (sales_crm_user there,
 * the platform super admin, the system owner) changes the status along the allowed transitions,
 * assigns the lead to staff who hold lead:manage there, and records notes and contacts. Every
 * change is audited (ids and statuses only, never note text) and the database writes the status
 * and assignment history itself (LeadActivity, actor = the session's user). Export stays DP-126.
 *
 * DP-103 (ADR-012B): the lead tables have row-level security. Their reads run in
 * `access.leadData`, whose database context is the admin session itself; the database opens only
 * the sites where it finds lead:read for that user (or the system owner), whatever site the
 * request names.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  DOWNLOAD_GRANT_MAX_DOWNLOADS,
  LEAD_ACTIVITY_LIMIT,
  LEADS_PAGE_SIZE,
  LeadActivityInputSchema,
  LeadAssigneeFilterSchema,
  LeadStatusSchema,
  LeadWorkflowInputSchema,
  UuidSchema,
  canTransition,
  type LeadActivity,
  type LeadActivityResponse,
  type LeadDetailResponse,
  type LeadListResponse,
  type LeadStatus,
  type LeadSummary,
  type LeadWorkflowResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";

const PERMISSION = "lead:read";
const MANAGE = "lead:manage";

/** A refusal of the DP-041/DP-096/DP-103 guards (trigger, CHECK or row-level security). */
const DB_REFUSAL =
  /leads: |row-level security|violates check constraint "Lead|insufficient_privilege|42501|23514/;
function isLeadDbRefusal(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && DB_REFUSAL.test(msg)) return true;
    const meta = (e as { meta?: unknown }).meta;
    if (meta && DB_REFUSAL.test(JSON.stringify(meta))) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const conflict = (rule: string, path = "lead") => new ApiError("CONFLICT_STATE", [{ path, rule }]);

interface LeadRow {
  id: string;
  siteId: string;
  email: string;
  fullName: string;
  company: string;
  country: string;
  freeMailDomain: boolean;
  marketingConsentAt: Date | null;
  requestCount: number;
  firstRequestAt: Date;
  lastRequestAt: Date;
  anonymisedAt: Date | null;
  retentionHold: "CUSTOMER" | "OPEN_OPPORTUNITY" | "LEGAL_HOLD" | null;
  status: LeadStatus;
  statusChangedAt: Date | null;
  assignedToId: string | null;
  assignedAt: Date | null;
  workflowVersion: number;
}

interface ActivityRow {
  id: string;
  kind: LeadActivity["kind"];
  actorUserId: string;
  body: string | null;
  redactedAt: Date | null;
  contactChannel: LeadActivity["contactChannel"];
  contactedAt: Date | null;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  fromAssigneeId: string | null;
  toAssigneeId: string | null;
  createdAt: Date;
}

const ACTIVITY_SELECT = {
  id: true,
  kind: true,
  actorUserId: true,
  body: true,
  redactedAt: true,
  contactChannel: true,
  contactedAt: true,
  fromStatus: true,
  toStatus: true,
  fromAssigneeId: true,
  toAssigneeId: true,
  createdAt: true,
} as const;

/** Names and current assignability that the summaries need. */
interface People {
  names: Map<string, string>;
  /** Per site: ids of staff who hold lead:manage there now. */
  assignable: Map<string, Set<string>>;
}

const LEAD_SELECT = {
  id: true,
  siteId: true,
  email: true,
  fullName: true,
  company: true,
  country: true,
  freeMailDomain: true,
  marketingConsentAt: true,
  requestCount: true,
  firstRequestAt: true,
  lastRequestAt: true,
  anonymisedAt: true,
  retentionHold: true,
  status: true,
  statusChangedAt: true,
  assignedToId: true,
  assignedAt: true,
  workflowVersion: true,
} as const;

export interface LeadListQuery {
  siteId?: string | undefined;
  cursor?: string | undefined;
  q?: string | undefined;
  /** DP-041 filters. */
  status?: string | undefined;
  assignee?: string | undefined;
}

/** Cursor: base64url of "<lastRequestAt ISO>|<id>" (keyset pagination, newest first). */
function encodeCursor(row: LeadRow): string {
  return Buffer.from(`${row.lastRequestAt.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(raw: string): { at: Date; id: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [at, id] = text.split("|");
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !UuidSchema.safeParse(id).success) {
    throw new ApiError("VALIDATION_FAILED", [{ path: "cursor", rule: "invalid" }]);
  }
  return { at: date, id: id as string };
}

@Injectable()
export class AdminLeadsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  private async readableSites(access: StaffAccess) {
    const ids = access.sitesWith(PERMISSION);
    if (ids.length === 0) {
      // No lead:read anywhere: refused and audited like any other permission check.
      await access.require(PERMISSION, { scope: "platform" }, { type: "lead", id: null });
    }
    return access.sites.filter((s) => ids.includes(s.id));
  }

  private async people(
    access: StaffAccess,
    rows: readonly LeadRow[],
    extraIds: readonly string[] = [],
  ): Promise<People> {
    const assigned = rows.filter((r) => r.assignedToId);
    const siteIds = [...new Set(assigned.map((r) => r.siteId))];
    const [names, bySite] = await Promise.all([
      access.staffNames([...assigned.map((r) => r.assignedToId as string), ...extraIds]),
      access.leadAssignees(siteIds),
    ]);
    const assignable = new Map(
      [...bySite].map(([siteId, list]) => [siteId, new Set(list.map((u) => u.id))]),
    );
    return { names, assignable };
  }

  private summary(row: LeadRow, siteKey: "BV" | "CORPORATE", people: People): LeadSummary {
    const assignee = row.assignedToId;
    return {
      id: row.id,
      siteId: row.siteId,
      siteKey,
      email: row.email,
      fullName: row.fullName,
      company: row.company,
      country: row.country,
      freeMailDomain: row.freeMailDomain,
      marketingConsentAt: row.marketingConsentAt?.toISOString() ?? null,
      requestCount: row.requestCount,
      firstRequestAt: row.firstRequestAt.toISOString(),
      lastRequestAt: row.lastRequestAt.toISOString(),
      anonymisedAt: row.anonymisedAt?.toISOString() ?? null,
      retentionHold: row.retentionHold,
      status: row.status,
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
      assignedTo: assignee
        ? {
            id: assignee,
            displayName: people.names.get(assignee) ?? "Former staff member",
            active: people.assignable.get(row.siteId)?.has(assignee) ?? false,
          }
        : null,
      assignedAt: row.assignedAt?.toISOString() ?? null,
      workflowVersion: row.workflowVersion,
    };
  }

  private activity(row: ActivityRow, names: Map<string, string>): LeadActivity {
    const who = (id: string | null) =>
      id ? { id, displayName: names.get(id) ?? "Former staff member" } : null;
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
      actor: who(row.actorUserId) as { id: string; displayName: string },
      body: row.body,
      redactedAt: row.redactedAt?.toISOString() ?? null,
      contactChannel: row.contactChannel,
      contactedAt: row.contactedAt?.toISOString() ?? null,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      fromAssignee: who(row.fromAssigneeId),
      toAssignee: who(row.toAssigneeId),
    };
  }

  async list(ctx: RequestContext, query: LeadListQuery): Promise<LeadListResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.readableSites(access);
    let siteIds = sites.map((s) => s.id);
    if (query.siteId !== undefined) {
      const wanted = query.siteId.toLowerCase();
      if (!siteIds.includes(wanted)) {
        await access.require(
          PERMISSION,
          { scope: "site", siteId: wanted },
          { type: "lead", id: null },
        );
      }
      siteIds = [wanted];
    }
    const q = query.q?.trim().slice(0, 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    let status: LeadStatus | undefined;
    if (query.status !== undefined) {
      const parsed = LeadStatusSchema.safeParse(query.status);
      if (!parsed.success)
        throw new ApiError("VALIDATION_FAILED", [{ path: "status", rule: "invalid" }]);
      status = parsed.data;
    }
    let assignedToId: string | null | undefined;
    let assigneeFilter: "me" | "none" | "user" | undefined;
    if (query.assignee !== undefined) {
      const parsed = LeadAssigneeFilterSchema.safeParse(query.assignee.toLowerCase());
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", [{ path: "assignee", rule: "invalid" }]);
      }
      assigneeFilter = parsed.data === "me" || parsed.data === "none" ? parsed.data : "user";
      assignedToId =
        parsed.data === "me" ? access.userId : parsed.data === "none" ? null : parsed.data;
    }
    const scope = { siteIds, includePlatform: false };
    const db = access.db(scope);
    // DP-103: the lead rows come through the session's database context (row-level security).
    const rows: LeadRow[] = await access.leadData(scope, (tx) =>
      tx.lead.findMany({
        where: {
          siteId: { in: siteIds },
          ...(status ? { status } : {}),
          ...(assignedToId !== undefined ? { assignedToId } : {}),
          ...(q
            ? {
                OR: [
                  { email: { contains: q, mode: "insensitive" } },
                  { company: { contains: q, mode: "insensitive" } },
                  { fullName: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(cursor
            ? {
                AND: [
                  {
                    OR: [
                      { lastRequestAt: { lt: cursor.at } },
                      { lastRequestAt: cursor.at, id: { lt: cursor.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ lastRequestAt: "desc" }, { id: "desc" }],
        take: LEADS_PAGE_SIZE + 1,
        select: LEAD_SELECT,
      }),
    );
    const page = rows.slice(0, LEADS_PAGE_SIZE);
    const keyOf = new Map(sites.map((s) => [s.id, s.key]));
    const people = await this.people(access, page);
    // A read across several sites is a platform-level event (siteId null); the lead queries above
    // stay limited to the sites (Lead has no platform rows), only the audit write needs the
    // platform scope (DP-076: the platform customer-data officer reads every site).
    const auditDb = siteIds.length === 1 ? db : access.db({ siteIds, includePlatform: true });
    await access.audit(auditDb, {
      action: "leads.list_viewed",
      resourceType: "lead",
      resourceId: null,
      siteId: siteIds.length === 1 ? (siteIds[0] as string) : null,
      permission: PERMISSION,
      metadata: {
        siteIds,
        count: page.length,
        searched: Boolean(q),
        paged: Boolean(cursor),
        ...(status ? { status } : {}),
        ...(assigneeFilter ? { assignee: assigneeFilter } : {}),
        accessAssignmentIds: access.grantRefs(PERMISSION, siteIds),
      },
    });
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.summary(r, keyOf.get(r.siteId) ?? "BV", people)),
      nextCursor: rows.length > LEADS_PAGE_SIZE && last ? encodeCursor(last) : null,
      sites: sites.map((s) => ({ id: s.id, key: s.key, name: s.name })),
    };
  }

  async detail(ctx: RequestContext, rawId: string): Promise<LeadDetailResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.readableSites(access);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const siteIds = sites.map((s) => s.id);
    const scope = { siteIds, includePlatform: false };
    const db = access.db(scope);
    // DP-103: every lead-table read in one transaction with the session's database context.
    const found = await access.leadData(scope, async (tx) => {
      const row: LeadRow | null = await tx.lead.findFirst({
        where: { id, siteId: { in: siteIds } },
        select: LEAD_SELECT,
      });
      if (!row) return null;
      const reqs = await tx.leadDocumentRequest.findMany({
        where: { leadId: row.id, siteId: row.siteId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const ids = reqs.map((r) => r.id);
      const grantRows = await tx.documentDownloadGrant.findMany({
        where: { siteId: row.siteId, requestId: { in: ids } },
        select: { requestId: true, expiresAt: true, downloadCount: true },
      });
      const downloadRows = await tx.leadDocumentDownload.findMany({
        where: { siteId: row.siteId, requestId: { in: ids } },
        orderBy: { deliveredAt: "asc" },
        select: { requestId: true, deliveredAt: true, byteSize: true, sha256: true },
      });
      const activityRows: ActivityRow[] = await tx.leadActivity.findMany({
        where: { leadId: row.id, siteId: row.siteId },
        orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
        take: LEAD_ACTIVITY_LIMIT,
        select: ACTIVITY_SELECT,
      });
      return {
        lead: row,
        requests: reqs,
        grants: grantRows,
        downloads: downloadRows,
        activities: activityRows,
      };
    });
    if (!found) {
      // Unknown, or a lead of a site the caller may not read (looks the same: IDOR).
      await access.denied(PERMISSION, { type: "lead", id }, "not_found_or_other_site");
      throw new ApiError("NOT_FOUND");
    }
    const { lead, requests, grants, downloads, activities } = found;
    const canManage =
      lead.anonymisedAt === null && access.allows(MANAGE, { scope: "site", siteId: lead.siteId });
    const [people, assignees] = await Promise.all([
      this.people(
        access,
        [lead],
        activities.flatMap((a) =>
          [a.actorUserId, a.fromAssigneeId, a.toAssigneeId].filter((x): x is string => !!x),
        ),
      ),
      canManage
        ? access.leadAssignees([lead.siteId]).then((m) => m.get(lead.siteId) ?? [])
        : Promise.resolve([]),
    ]);
    const [products, documents, revisions] = await Promise.all([
      db.product.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.productId))] } },
        select: { id: true, code: true, name: true, slug: true },
      }),
      db.productDocument.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.documentId))] } },
        select: { id: true, type: true, title: true },
      }),
      db.productDocumentRevision.findMany({
        where: { id: { in: [...new Set(requests.map((r) => r.revisionId))] } },
        select: { id: true, revisionNumber: true },
      }),
    ]);
    const grantOf = new Map(grants.map((g) => [g.requestId, g]));
    const productOf = new Map(products.map((p) => [p.id, p]));
    const documentOf = new Map(documents.map((d) => [d.id, d]));
    const revisionOf = new Map(revisions.map((r) => [r.id, r]));
    const site = sites.find((s) => s.id === lead.siteId);
    await access.audit(db, {
      action: "leads.lead_viewed",
      resourceType: "lead",
      resourceId: lead.id,
      siteId: lead.siteId,
      permission: PERMISSION,
      metadata: {
        requests: requests.length,
        activities: activities.length,
        accessAssignmentIds: access.grantRefs(PERMISSION, [lead.siteId]),
      },
    });
    return {
      lead: this.summary(lead, site?.key ?? "BV", people),
      activities: activities.map((a) => this.activity(a, people.names)),
      canManage,
      assignees,
      requests: requests.map((r) => {
        const g = grantOf.get(r.id);
        const p = productOf.get(r.productId);
        const d = documentOf.get(r.documentId);
        const v = revisionOf.get(r.revisionId);
        return {
          id: r.id,
          reference: r.reference,
          createdAt: r.createdAt.toISOString(),
          fullName: r.fullName,
          company: r.company,
          country: r.country,
          product: {
            id: r.productId,
            code: p?.code ?? "",
            name: p?.name ?? "",
            slug: p?.slug ?? "",
          },
          document: { id: r.documentId, type: d?.type ?? "OTHER", title: d?.title ?? "" },
          revision: { id: r.revisionId, revisionNumber: v?.revisionNumber ?? 0 },
          privacyNoticeVersion: r.privacyNoticeVersion,
          privacyNoticeSha256: r.privacyNoticeSha256,
          marketingConsent: r.marketingConsent,
          marketingConsentVersion: r.marketingConsentVersion,
          grant: g
            ? {
                expiresAt: g.expiresAt.toISOString(),
                downloadCount: g.downloadCount,
                maxDownloads: DOWNLOAD_GRANT_MAX_DOWNLOADS,
              }
            : null,
          downloads: downloads
            .filter((x) => x.requestId === r.id)
            .map((x) => ({
              deliveredAt: x.deliveredAt.toISOString(),
              byteSize: x.byteSize,
              sha256: x.sha256,
            })),
        };
      }),
    };
  }
  // --- sales workflow (DP-041, ADR-019) -----------------------------------------------------

  /**
   * The sites where the caller may work leads; refused (403, audited) when there is none. The
   * database decides again from the session (lead_staff_update, activity_staff_insert).
   */
  private async manageableSites(access: StaffAccess): Promise<string[]> {
    const ids = access.sitesWith(MANAGE);
    if (ids.length === 0) {
      await access.require(MANAGE, { scope: "platform" }, { type: "lead", id: null });
    }
    return ids;
  }

  /** Runs one workflow write; a refusal of the database guards becomes 409 (audited). */
  private async write<T>(
    access: StaffAccess,
    leadId: string,
    siteIds: string[],
    fn: (tx: SiteScopedClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await access.leadData({ siteIds, includePlatform: false }, fn);
    } catch (error) {
      if (error instanceof ApiError || !isLeadDbRefusal(error)) throw error;
      await access.denied(MANAGE, { type: "lead", id: leadId }, "db_guard");
      throw conflict("db_guard");
    }
  }

  /** The lead visible to a manager, or 404 (unknown, other site, or no lead:manage there). */
  private async manageable(
    access: StaffAccess,
    tx: SiteScopedClient,
    id: string,
    siteIds: string[],
  ): Promise<LeadRow> {
    const row: LeadRow | null = await tx.lead.findFirst({
      where: { id, siteId: { in: siteIds } },
      select: LEAD_SELECT,
    });
    if (!row) {
      await access.denied(MANAGE, { type: "lead", id }, "not_found_or_other_site");
      throw new ApiError("NOT_FOUND");
    }
    if (row.anonymisedAt) throw conflict("anonymised");
    return row;
  }

  private async current(
    access: StaffAccess,
    tx: SiteScopedClient,
    id: string,
    siteIds: string[],
  ): Promise<LeadSummary> {
    const row: LeadRow = await tx.lead.findFirstOrThrow({
      where: { id, siteId: { in: siteIds } },
      select: LEAD_SELECT,
    });
    const key = access.sites.find((s) => s.id === row.siteId)?.key ?? "BV";
    return this.summary(row, key, await this.people(access, [row]));
  }

  /** Status and/or assignment change with optimistic concurrency (`version`). */
  async workflow(ctx: RequestContext, rawId: string, body: unknown): Promise<LeadWorkflowResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageableSites(access);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const input = parseBody(LeadWorkflowInputSchema, body);
    const lead = await this.write(access, id, siteIds, async (tx) => {
      const row = await this.manageable(access, tx, id, siteIds);
      if (row.workflowVersion !== input.version) throw conflict("stale", "version");
      const data: { status?: LeadStatus; assignedToId?: string | null } = {};
      if (input.status !== undefined && input.status !== row.status) {
        if (!canTransition(row.status, input.status)) throw conflict("transition", "status");
        data.status = input.status;
      }
      const assignee = input.assignedToId?.toLowerCase() ?? input.assignedToId;
      if (assignee !== undefined && assignee !== row.assignedToId) {
        if (assignee !== null) {
          const allowed = (await access.leadAssignees([row.siteId])).get(row.siteId) ?? [];
          if (!allowed.some((u) => u.id === assignee)) {
            await access.denied(MANAGE, { type: "lead", id }, "assignee_not_eligible", {
              scope: "site",
              siteId: row.siteId,
            });
            throw new ApiError("VALIDATION_FAILED", [
              { path: "assignedToId", rule: "assignee_not_eligible" },
            ]);
          }
        }
        data.assignedToId = assignee;
      }
      if (data.status === undefined && data.assignedToId === undefined) {
        throw conflict("unchanged");
      }
      const updated = await tx.lead.updateMany({
        where: { id, siteId: row.siteId, workflowVersion: input.version },
        data,
      });
      if (updated.count !== 1) throw conflict("stale", "version");
      let noteId: string | null = null;
      if (input.note) {
        noteId = (
          await tx.leadActivity.create({
            data: {
              siteId: row.siteId,
              leadId: id,
              kind: "NOTE",
              actorUserId: access.userId,
              body: input.note,
            },
            select: { id: true },
          })
        ).id;
      }
      if (data.status !== undefined) {
        await access.audit(tx, {
          action: "leads.status_changed",
          resourceType: "lead",
          resourceId: id,
          siteId: row.siteId,
          permission: MANAGE,
          metadata: {
            from: row.status,
            to: data.status,
            version: input.version + 1,
            accessAssignmentIds: access.grantRefs(MANAGE, [row.siteId]),
          },
        });
      }
      if (data.assignedToId !== undefined) {
        await access.audit(tx, {
          action: "leads.assignment_changed",
          resourceType: "lead",
          resourceId: id,
          siteId: row.siteId,
          permission: MANAGE,
          metadata: {
            fromUserId: row.assignedToId,
            toUserId: data.assignedToId,
            version: input.version + 1,
            accessAssignmentIds: access.grantRefs(MANAGE, [row.siteId]),
          },
        });
      }
      if (noteId) {
        await access.audit(tx, {
          action: "leads.note_added",
          resourceType: "lead",
          resourceId: id,
          siteId: row.siteId,
          permission: MANAGE,
          metadata: { activityId: noteId, withWorkflowChange: true },
        });
      }
      return this.current(access, tx, id, [row.siteId]);
    });
    return { lead };
  }

  /** A note or a contact record. */
  async addActivity(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<LeadActivityResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageableSites(access);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const input = parseBody(LeadActivityInputSchema, body);
    const contactedAt = input.kind === "CONTACT" ? new Date(input.contactedAt) : null;
    if (contactedAt && contactedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "contactedAt", rule: "future" }]);
    }
    const row = await this.write(access, id, siteIds, async (tx) => {
      const lead = await this.manageable(access, tx, id, siteIds);
      const created: ActivityRow = await tx.leadActivity.create({
        data: {
          siteId: lead.siteId,
          leadId: id,
          kind: input.kind,
          actorUserId: access.userId,
          body: input.body,
          ...(input.kind === "CONTACT" ? { contactChannel: input.channel, contactedAt } : {}),
        },
        select: ACTIVITY_SELECT,
      });
      await access.audit(tx, {
        action: input.kind === "NOTE" ? "leads.note_added" : "leads.contact_logged",
        resourceType: "lead",
        resourceId: id,
        siteId: lead.siteId,
        permission: MANAGE,
        metadata: {
          activityId: created.id,
          ...(input.kind === "CONTACT" ? { channel: input.channel } : {}),
          accessAssignmentIds: access.grantRefs(MANAGE, [lead.siteId]),
        },
      });
      return created;
    });
    const names = await access.staffNames([row.actorUserId]);
    return { activity: this.activity(row, names) };
  }
}
