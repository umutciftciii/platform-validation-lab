/**
 * Request-level access for staff business modules (PM-1 onwards). Business code (src/catalog, …)
 * may not hold the unscoped Prisma client (ESLint, ADR-011), so this infrastructure service is
 * its only way in:
 *
 *  1. `begin(ctx)` resolves the admin session and the authorization snapshot (deny by default;
 *     step-up freshness only matters for `sensitive` permissions, decided by `decide`).
 *  2. `allows` / `sitesWith` answer permission questions without side effects.
 *  3. `require` refuses with 403 FORBIDDEN and writes a DENIED audit event (the reason stays
 *     internal, NT-R9).
 *  4. `db(scope)` hands out the site-scoped client for the sites the caller was authorised for.
 *  5. `audit(db, …)` writes a SUCCESS event inside the caller's transaction.
 *  6. `leadData(scope, fn)` runs lead-table reads in the database context of this admin session
 *     (DP-103, lead-data.ts): row-level security decides again, from the session itself. The
 *     DP-041 sales workflow writes through it too (status, assignment, activity).
 *  7. `leadAssignees` / `staffNames` (DP-041, lead-assignees.ts): staff who may work a site's
 *     leads, and display names for the lead history.
 */
import { Inject, Injectable } from "@nestjs/common";
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  decide,
  isGrantActive,
  type AuthorizationSnapshot,
  type Target,
} from "../authorization.js";
import { PERMISSION_BY_KEY, ROLE_BY_KEY } from "../catalog.js";
import type { Db } from "../db.js";
import { leadAssigneesBySite, staffNames, type LeadStaffUser } from "../lead-assignees.js";
import { inLeadContext } from "../lead-data.js";
import { ApiError } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import { loadAuthorizationSnapshot } from "../repository.js";
import { withSiteScope, type SiteScope, type SiteScopedClient } from "../site-scope.js";
import { writeAudit } from "./audit-writer.js";
import { StaffSessionService, isStepUpFresh } from "./sessions.js";

const PLATFORM: Target = { scope: "platform" };

export interface AccessSite {
  id: string;
  key: "BV" | "CORPORATE";
  name: string;
}

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId: string | null;
  /** null = platform-level event. */
  siteId: string | null;
  permission: string;
  metadata?: Record<string, unknown>;
  /** PM-5: a refused input (e.g. a rejected upload) is a FAILURE with a reason code. */
  failure?: { reason: string };
}

export class StaffAccess {
  constructor(
    readonly userId: string,
    readonly sites: readonly AccessSite[],
    private readonly snapshot: AuthorizationSnapshot,
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContext,
    private readonly now: Date,
    private readonly sessionToken: string,
  ) {}

  allows(permission: string, target: Target): boolean {
    return decide(this.snapshot, permission, target, this.now).allowed;
  }

  /** Ids of the sites where the permission is allowed. */
  sitesWith(permission: string): string[] {
    return this.sites
      .filter((s) => this.allows(permission, { scope: "site", siteId: s.id }))
      .map((s) => s.id);
  }

  /**
   * Ids of the active role assignments that carry the permission on any of the sites (ADR-017 D7):
   * customer-data reads name them in the audit event, so every read points to the approved,
   * justified access request behind it.
   */
  grantRefs(permission: string, siteIds: readonly string[]): string[] {
    const ids = new Set<string>();
    for (const g of this.snapshot.grants) {
      if (!g.assignmentId || !isGrantActive(g, this.now)) continue;
      if (!ROLE_BY_KEY.get(g.roleKey)?.permissions.includes(permission)) continue;
      if (g.scopeType === "PLATFORM" || (g.siteId && siteIds.includes(g.siteId))) {
        ids.add(g.assignmentId);
      }
    }
    return [...ids].sort();
  }

  /** Allows or throws 403 FORBIDDEN after a DENIED audit event. Unknown sites are refused too. */
  async require(
    permission: string,
    target: Target,
    resource: { type: string; id: string | null },
  ): Promise<void> {
    const knownSite = target.scope === "platform" || this.sites.some((s) => s.id === target.siteId);
    const decision = knownSite
      ? decide(this.snapshot, permission, target, this.now)
      : ({ allowed: false, reason: "unknown_site" } as const);
    if (decision.allowed) return;
    await this.denied(permission, resource, decision.reason, knownSite ? target : PLATFORM);
    throw new ApiError("FORBIDDEN");
  }

  /**
   * A DENIED audit event without throwing: for callers that answer 404 because the resource is
   * outside every site they may act on (an IDOR attempt looks like an unknown id).
   */
  denied(
    permission: string,
    resource: { type: string; id: string | null },
    reason: string,
    target: Target = PLATFORM,
  ): Promise<void> {
    const siteId = target.scope === "site" ? target.siteId : null;
    return writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: this.userId,
      action: `${PERMISSION_BY_KEY.get(permission)?.module ?? "iam"}.access_denied`,
      resourceType: resource.type,
      resourceId: resource.id,
      scopeType: siteId ? "SITE" : "PLATFORM",
      siteId,
      outcome: "DENIED",
      reason,
      metadata: { permission },
      requestId: this.ctx.requestId,
    });
  }

  /** The site-scoped client. Pass only sites the caller was authorised for. */
  db(scope: SiteScope): SiteScopedClient {
    return withSiteScope(this.prisma, scope);
  }

  /**
   * Lead-table reads (DP-103): one transaction whose database context is this admin session. The
   * database finds the readable sites itself; `scope` (sites the caller was authorised for) only
   * narrows further.
   */
  leadData<T>(scope: SiteScope, fn: (db: SiteScopedClient) => Promise<T>): Promise<T> {
    return inLeadContext(
      this.prisma,
      scope,
      { kind: "staff", sessionToken: this.sessionToken },
      fn,
    );
  }

  /** DP-041: staff who may be assigned the leads of each site (lead:manage there). */
  leadAssignees(siteIds: readonly string[]): Promise<Map<string, LeadStaffUser[]>> {
    return leadAssigneesBySite(this.prisma, siteIds, this.now);
  }

  /** DP-041: display names of staff users (lead history actors and assignees). */
  staffNames(ids: readonly string[]): Promise<Map<string, string>> {
    return staffNames(this.prisma, ids);
  }

  /** A SUCCESS audit event, written with the given (scoped or transaction) client. */
  audit(db: unknown, input: AuditInput): Promise<void> {
    return writeAudit(db as Db, {
      actorType: "USER",
      actorUserId: this.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      scopeType: input.siteId ? "SITE" : "PLATFORM",
      siteId: input.siteId,
      outcome: input.failure ? "FAILURE" : "SUCCESS",
      ...(input.failure ? { reason: input.failure.reason } : {}),
      metadata: { permission: input.permission, ...input.metadata },
      requestId: this.ctx.requestId,
    });
  }
}

@Injectable()
export class StaffAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  async begin(ctx: RequestContext): Promise<StaffAccess> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const snapshot = await loadAuthorizationSnapshot(this.prisma, session.userId, {
      mfaVerified: isStepUpFresh(session.mfaVerifiedAt, now),
    });
    if (!snapshot) throw new ApiError("AUTH_SESSION_REQUIRED");
    const sites = await this.prisma.site.findMany({
      select: { id: true, key: true, name: true },
      orderBy: { key: "asc" },
    });
    // require() succeeded, so the cookie holds the live session token (rotation sets a new one).
    const token = ctx.cookies.get(ADMIN_SESSION_COOKIE) ?? "";
    return new StaffAccess(session.userId, sites, snapshot, this.prisma, ctx, now, token);
  }
}
