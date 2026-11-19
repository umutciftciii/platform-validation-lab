/**
 * Contact-form notification settings (DP-221, ADR-026 D3), per site.
 *
 * Who: staff with `lead:manage` on the site (the sales lead / CRM user there, the platform super
 * admin, the system owner): the people who already decide who works the site's leads. No new
 * permission or role. Who can be notified: active staff with `lead:read` on the site (the people
 * who may open the lead the e-mail links to). The database checks both again: the row-level
 * security of "LeadNotificationSetting" (lead:manage of the session's own user) and its guard
 * (every person added reads the site's leads). Saves use optimistic concurrency (`version`) and
 * are audited with ids only.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  LEAD_NOTIFICATION_STATUSES,
  LeadNotificationSettingsInputSchema,
  UuidSchema,
  type LeadNotificationSaveResponse,
  type LeadNotificationSettingsResponse,
  type LeadNotificationSiteSettings,
  type LeadNotificationStatus,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type AccessSite, type StaffAccess } from "../iam/staff/access.js";
import type { LeadStaffUser } from "../iam/lead-assignees.js";
import { MAIL_SENDER, type MailSender } from "../notifications/mail.js";

const MANAGE = "lead:manage";
const RECENT_DAYS = 30;
const DB_REFUSAL = /leads: |row-level security|insufficient_privilege|42501|23514/;

function isDbRefusal(error: unknown): boolean {
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

interface SettingRow {
  siteId: string;
  enabled: boolean;
  recipientUserIds: string[];
  version: number;
  updatedAt: Date;
  updatedById: string | null;
}

@Injectable()
export class LeadNotificationSettingsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  private async managedSites(access: StaffAccess): Promise<AccessSite[]> {
    const ids = access.sitesWith(MANAGE);
    if (ids.length === 0) {
      await access.require(
        MANAGE,
        { scope: "platform" },
        { type: "lead_notification_setting", id: null },
      );
    }
    return access.sites.filter((s) => ids.includes(s.id));
  }

  private async view(
    access: StaffAccess,
    sites: AccessSite[],
  ): Promise<LeadNotificationSiteSettings[]> {
    const siteIds = sites.map((s) => s.id);
    const db = access.db({ siteIds, includePlatform: false });
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const [rows, candidates, counts] = await Promise.all([
      db.leadNotificationSetting.findMany({
        where: { siteId: { in: siteIds } },
        select: {
          siteId: true,
          enabled: true,
          recipientUserIds: true,
          version: true,
          updatedAt: true,
          updatedById: true,
        },
      }) as Promise<SettingRow[]>,
      access.notificationCandidates(siteIds),
      db.leadNotification.groupBy({
        by: ["siteId", "status"],
        where: { siteId: { in: siteIds }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const rowOf = new Map(rows.map((r) => [r.siteId, r]));
    const listed = [...new Set(rows.flatMap((r) => r.recipientUserIds))];
    const users = listed.length
      ? await db.user.findMany({
          where: { id: { in: listed } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    const userOf = new Map(users.map((u) => [u.id, u]));
    const names = await access.staffNames(
      rows.map((r) => r.updatedById).filter((x): x is string => !!x),
    );
    return sites.map((site) => {
      const row = rowOf.get(site.id);
      const eligible: LeadStaffUser[] = candidates.get(site.id) ?? [];
      const eligibleIds = new Set(eligible.map((u) => u.id));
      const recent = Object.fromEntries(LEAD_NOTIFICATION_STATUSES.map((s) => [s, 0])) as Record<
        LeadNotificationStatus,
        number
      >;
      for (const c of counts) if (c.siteId === site.id) recent[c.status] = c._count._all;
      return {
        site: { id: site.id, key: site.key, name: site.name },
        enabled: row?.enabled ?? false,
        recipients: (row?.recipientUserIds ?? []).map((id) => {
          const u = userOf.get(id);
          return {
            id,
            displayName: u ? u.displayName?.trim() || u.email : "Former staff member",
            email: u?.email ?? "",
            eligible: eligibleIds.has(id),
          };
        }),
        candidates: eligible.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email })),
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        updatedBy: row?.updatedById
          ? {
              id: row.updatedById,
              displayName: names.get(row.updatedById) ?? "Former staff member",
            }
          : null,
        recent,
      };
    });
  }

  async get(ctx: RequestContext): Promise<LeadNotificationSettingsResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.managedSites(access);
    return { transport: this.mail.transport, sites: await this.view(access, sites) };
  }

  async save(
    ctx: RequestContext,
    rawSiteId: string,
    body: unknown,
  ): Promise<LeadNotificationSaveResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.managedSites(access);
    if (!UuidSchema.safeParse(rawSiteId).success) throw new ApiError("NOT_FOUND");
    const siteId = rawSiteId.toLowerCase();
    const site = sites.find((s) => s.id === siteId);
    if (!site) {
      await access.require(
        MANAGE,
        { scope: "site", siteId },
        { type: "lead_notification_setting", id: siteId },
      );
      throw new ApiError("NOT_FOUND");
    }
    const input = parseBody(LeadNotificationSettingsInputSchema, body);
    const wanted = input.recipientUserIds.map((id) => id.toLowerCase());
    const scope = { siteIds: [siteId], includePlatform: false };

    // Everyone newly added must read the site's leads now (the database checks it again).
    const candidates = (await access.notificationCandidates([siteId])).get(siteId) ?? [];
    const eligible = new Set(candidates.map((u) => u.id));
    const current = await access.db(scope).leadNotificationSetting.findUnique({
      where: { siteId },
      select: { version: true, recipientUserIds: true, enabled: true },
    });
    const kept = new Set(current?.recipientUserIds ?? []);
    const notEligible = wanted.filter((id) => !eligible.has(id) && !kept.has(id));
    if (notEligible.length > 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        notEligible.map(() => ({ path: "recipientUserIds", rule: "recipient_not_eligible" })),
      );
    }
    if ((current?.version ?? 0) !== input.version) {
      throw new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
    }
    try {
      await access.leadData(scope, async (tx) => {
        const data = {
          enabled: input.enabled,
          recipientUserIds: wanted,
          updatedById: access.userId,
        };
        if (current) {
          const done = await tx.leadNotificationSetting.updateMany({
            where: { siteId, version: input.version },
            data: { ...data, version: input.version + 1 },
          });
          if (done.count !== 1) {
            throw new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
          }
        } else {
          await tx.leadNotificationSetting.create({ data: { ...data, siteId, version: 1 } });
        }
        await access.audit(tx, {
          action: "leads.notification_settings_changed",
          resourceType: "lead_notification_setting",
          resourceId: siteId,
          siteId,
          permission: MANAGE,
          metadata: {
            enabled: input.enabled,
            wasEnabled: current?.enabled ?? false,
            recipientUserIds: wanted,
            added: wanted.filter((id) => !kept.has(id)),
            removed: [...kept].filter((id) => !wanted.includes(id)),
            version: input.version + 1,
            accessAssignmentIds: access.grantRefs(MANAGE, [siteId]),
          },
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (!isDbRefusal(error)) {
        // Two first saves at once: the second finds the row now.
        if ((error as { code?: unknown }).code === "P2002") {
          throw new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
        }
        throw error;
      }
      await access.denied(MANAGE, { type: "lead_notification_setting", id: siteId }, "db_guard");
      throw new ApiError("CONFLICT_STATE", [{ path: "recipientUserIds", rule: "db_guard" }]);
    }
    const [view] = await this.view(access, [site]);
    return { site: view as LeadNotificationSiteSettings };
  }
}
