/**
 * Staff list, direct role assignment and revocation (DP-076 revision, DP-107; ADR-017 v2).
 *
 * The owner's 2026-11-11 decision replaced the dual-approval workflow: a holder of
 * role_assignment:grant assigns any role within its own permissions (no-escalation rule,
 * escalation.ts), customer-data roles included, without a second approver, justification or
 * mandatory expiry. Revocation needs role_assignment:revoke at the assignment's scope and keeps
 * the last-administrator rule. Both rely on the MFA of the sign-in (no extra step-up). The
 * database still refuses reciprocal grants and removing the last administrator. Every change and
 * every refusal is audited.
 *
 * DP-108 (ADR-018, K2): the system owner is not part of this screen. It is left out of the staff
 * list, nobody can give it a role or revoke one of its roles (404, and the database refuses too),
 * and a role the owner granted shows "System" as its grantor.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ADMIN_SESSION_COOKIE,
  AssignRoleRequestSchema,
  RevokeRoleRequestSchema,
  type AssignRoleResponse,
  type AssignableRole,
  type StaffListResponse,
  type StaffMember,
  type StaffRoleAssignment,
} from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  decide,
  isGrantActive,
  type AuthorizationSnapshot,
  type Target,
} from "../authorization.js";
import {
  PLATFORM_SUPER_ADMIN,
  ROLES,
  ROLE_BY_KEY,
  isAssignableRole,
  isCustomerDataRole,
} from "../catalog.js";
import { canAssignRole, canRevokeRole, type EscalationDenyReason } from "../escalation.js";
import { ApiError, parseBody } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import {
  countOtherPlatformAdmins,
  loadAuthorizationSnapshot,
  loadGrantAncestry,
  loadSystemOwnerId,
} from "../repository.js";
import { inStaffContext, platformAdminCount } from "../iam-context.js";
import { writeAudit } from "./audit-writer.js";
import { StaffSessionService, isStepUpFresh } from "./sessions.js";
import { isLastAdminDbError } from "./user-admin.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM: Target = { scope: "platform" };
const NOBODY = "00000000-0000-0000-0000-000000000000";
const DB_REFUSAL = /iam: [a-z]/i;
/** DP-108 (K2): how a role granted by the system owner names its grantor on staff screens. */
export const SYSTEM_GRANTOR_LABEL = "System";

/** A refusal by one of the IAM guard triggers (message prefix `iam:`). */
function isIamDbRefusal(error: unknown): boolean {
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

interface Actor {
  userId: string;
  snapshot: AuthorizationSnapshot;
  /** The raw admin session token: the database context of every IAM read and write (DP-125). */
  token: string;
}

type Refusal =
  | EscalationDenyReason
  | "not_found"
  | "unknown_site"
  | "not_staff"
  | "membership_inactive"
  | "already_assigned"
  | "expiry_in_past"
  | "already_ended"
  | "db_guard"
  | "owner_target";

const CONFLICTS: ReadonlySet<Refusal> = new Set([
  "self_grant",
  "reciprocal_grant",
  "assignee_inactive",
  "membership_inactive",
  "already_assigned",
  "already_ended",
  "db_guard",
]);
const INPUT: ReadonlySet<Refusal> = new Set([
  "unknown_role",
  "scope_mismatch",
  "audience_mismatch",
  "expiry_in_past",
]);

@Injectable()
export class StaffRolesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  private async actor(ctx: RequestContext): Promise<Actor> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const token = ctx.cookies.get(ADMIN_SESSION_COOKIE) ?? "";
    const snapshot = await inStaffContext(this.prisma, token, async (tx) => {
      const snap = await loadAuthorizationSnapshot(tx, session.userId, {
        mfaVerified: isStepUpFresh(session.mfaVerifiedAt, now),
      });
      if (snap) snap.grantAncestry = await loadGrantAncestry(tx);
      return snap;
    });
    if (!snapshot) throw new ApiError("AUTH_SESSION_REQUIRED");
    return { userId: session.userId, snapshot, token };
  }

  private async refuse(
    ctx: RequestContext,
    actor: Actor,
    action: "assign" | "revoke" | "list",
    reason: Refusal,
    resourceId: string | null,
    siteId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<never> {
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: actor.userId,
      action: "iam.role_assignment_denied",
      resourceType: "role_assignment",
      resourceId,
      scopeType: siteId ? "SITE" : "PLATFORM",
      siteId,
      outcome: "DENIED",
      reason,
      metadata: { step: action, ...metadata },
      requestId: ctx.requestId,
    });
    if (reason === "last_platform_admin") throw new ApiError("CONFLICT_LAST_ADMIN");
    if (reason === "mfa_required") throw new ApiError("AUTH_STEP_UP_REQUIRED");
    if (
      reason === "not_found" ||
      reason === "unknown_site" ||
      reason === "not_staff" ||
      reason === "owner_target"
    ) {
      throw new ApiError("NOT_FOUND");
    }
    if (INPUT.has(reason)) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "(root)", rule: reason }]);
    }
    if (CONFLICTS.has(reason)) {
      throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: reason }]);
    }
    throw new ApiError("FORBIDDEN");
  }

  // --- list ---------------------------------------------------------------------------------

  async list(ctx: RequestContext): Promise<StaffListResponse> {
    const actor = await this.actor(ctx);
    const now = this.clock.now();
    const sites = await this.prisma.site.findMany({
      select: { id: true, key: true, name: true },
      orderBy: { key: "asc" },
    });
    const platformView = decide(actor.snapshot, "user:read", PLATFORM, now).allowed;
    const siteIds = sites
      .filter(
        (s) => decide(actor.snapshot, "user:read", { scope: "site", siteId: s.id }, now).allowed,
      )
      .map((s) => s.id);
    if (!platformView && siteIds.length === 0) {
      await this.refuse(ctx, actor, "list", "not_allowed", null, null);
    }
    const ownerId = await loadSystemOwnerId(this.prisma);
    // DP-125: one staff-context transaction; row-level security shows the viewer only the
    // memberships and assignments of the sites it administers (and the platform for platform
    // administrators), the same rows the filters below keep.
    const { users, adminCount } = await inStaffContext(this.prisma, actor.token, async (tx) => ({
      users: await tx.user.findMany({
        where: {
          kind: "STAFF",
          ...(ownerId ? { id: { not: ownerId } } : {}),
          ...(platformView
            ? {}
            : { memberships: { some: { siteId: { in: siteIds }, status: { not: "REVOKED" } } } }),
        },
        orderBy: [{ status: "asc" }, { email: "asc" }],
        take: 1000,
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          mfaEnrolledAt: true,
          memberships: { select: { siteId: true, status: true } },
          roleAssignments: {
            where: { revokedAt: null },
            orderBy: { grantedAt: "asc" },
            select: {
              id: true,
              scopeType: true,
              siteId: true,
              grantedAt: true,
              expiresAt: true,
              revokedAt: true,
              role: { select: { key: true, name: true } },
              grantedBy: { select: { id: true, email: true, displayName: true } },
            },
          },
        },
      }),
      // Every platform administrator, counted by the database (platform viewers only; a site
      // viewer cannot revoke a platform role anyway, canRevokeRole refuses it first).
      adminCount: (await platformAdminCount(tx, null)) ?? 0,
    }));
    const isActivePlatformAdmin = (u: (typeof users)[number]) =>
      u.roleAssignments.some(
        (a) =>
          a.role.key === PLATFORM_SUPER_ADMIN &&
          a.scopeType === "PLATFORM" &&
          (!a.expiresAt || a.expiresAt > now) &&
          (u.status === "ACTIVE" || u.status === "PENDING"),
      );
    const staff: StaffMember[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName ?? u.email,
      status: u.status,
      mfaEnrolled: u.mfaEnrolledAt !== null,
      memberships: u.memberships
        .filter((m) => platformView || siteIds.includes(m.siteId))
        .map((m) => ({ siteId: m.siteId, status: m.status })),
      roles: u.roleAssignments
        .filter((a) =>
          isGrantActive(
            {
              roleKey: a.role.key,
              scopeType: a.scopeType,
              siteId: a.siteId,
              expiresAt: a.expiresAt,
              revokedAt: a.revokedAt,
            },
            now,
          ),
        )
        .filter((a) => platformView || a.siteId === null || siteIds.includes(a.siteId))
        .map((a): StaffRoleAssignment => {
          const target: Target = a.siteId ? { scope: "site", siteId: a.siteId } : PLATFORM;
          const others = Math.max(0, adminCount - (isActivePlatformAdmin(u) ? 1 : 0));
          return {
            id: a.id,
            roleKey: a.role.key,
            roleName: a.role.name,
            scopeType: a.scopeType,
            siteId: a.siteId,
            grantedAt: a.grantedAt.toISOString(),
            expiresAt: a.expiresAt?.toISOString() ?? null,
            grantedBy: !a.grantedBy
              ? null
              : a.grantedBy.id === ownerId
                ? SYSTEM_GRANTOR_LABEL
                : (a.grantedBy.displayName ?? a.grantedBy.email),
            canRevoke: canRevokeRole(actor.snapshot, a.role.key, target, now, others).allowed,
          };
        }),
    }));
    return {
      staff,
      roles: this.assignableRoles(
        actor,
        sites.map((s) => s.id),
        now,
      ),
      sites,
      viewerId: actor.userId,
    };
  }

  /** Staff roles the viewer could assign, and where (an anonymous active staff assignee). */
  private assignableRoles(actor: Actor, siteIds: string[], now: Date): AssignableRole[] {
    const probe = { userId: NOBODY, kind: "STAFF" as const, status: "ACTIVE" as const };
    return ROLES.filter((r) => r.audience === "STAFF" && isAssignableRole(r)).map((r) => {
      const platform =
        r.scopeType === "PLATFORM" &&
        canAssignRole(actor.snapshot, probe, r.key, PLATFORM, now).allowed;
      const sites =
        r.scopeType === "SITE"
          ? siteIds.filter(
              (id) =>
                canAssignRole(actor.snapshot, probe, r.key, { scope: "site", siteId: id }, now)
                  .allowed,
            )
          : [];
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        scopeType: r.scopeType,
        customerData: isCustomerDataRole(r),
        siteIds: sites,
        platform,
      };
    });
  }

  // --- assign -------------------------------------------------------------------------------

  async assign(ctx: RequestContext, rawUserId: string, body: unknown): Promise<AssignRoleResponse> {
    const actor = await this.actor(ctx);
    const now = this.clock.now();
    const req = parseBody(AssignRoleRequestSchema, body);
    const siteId = req.siteId?.toLowerCase() ?? null;
    const role = ROLE_BY_KEY.get(req.roleKey);
    if (!role) return this.refuse(ctx, actor, "assign", "unknown_role", null, siteId);
    const target: Target =
      role.scopeType === "PLATFORM" ? PLATFORM : { scope: "site", siteId: siteId ?? "" };
    if ((role.scopeType === "SITE") !== (siteId !== null)) {
      return this.refuse(ctx, actor, "assign", "scope_mismatch", null, siteId, {
        roleKey: role.key,
      });
    }
    if (
      siteId &&
      !(await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } }))
    ) {
      return this.refuse(ctx, actor, "assign", "unknown_site", null, null, { roleKey: role.key });
    }
    const user = UUID.test(rawUserId)
      ? await this.prisma.user.findUnique({
          where: { id: rawUserId.toLowerCase() },
          select: { id: true, kind: true, status: true },
        })
      : null;
    if (!user)
      return this.refuse(ctx, actor, "assign", "not_found", null, siteId, { roleKey: role.key });
    if (user.kind !== "STAFF") {
      return this.refuse(ctx, actor, "assign", "not_staff", null, siteId, { roleKey: role.key });
    }
    const expiresAt = req.expiresAt ? new Date(req.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      return this.refuse(ctx, actor, "assign", "expiry_in_past", null, siteId, {
        roleKey: role.key,
      });
    }
    const ownerId = await loadSystemOwnerId(this.prisma);
    if (user.id === ownerId && actor.userId !== ownerId) {
      return this.refuse(ctx, actor, "assign", "owner_target", null, siteId, {
        roleKey: role.key,
        assigneeUserId: user.id,
      });
    }
    const decision = canAssignRole(
      actor.snapshot,
      { userId: user.id, kind: user.kind, status: user.status, isSystemOwner: user.id === ownerId },
      role.key,
      target,
      now,
    );
    if (!decision.allowed) {
      return this.refuse(ctx, actor, "assign", decision.reason, null, siteId, {
        roleKey: role.key,
        assigneeUserId: user.id,
      });
    }
    const membership = siteId
      ? await inStaffContext(this.prisma, actor.token, (tx) =>
          tx.membership.findUnique({
            where: { userId_siteId: { userId: user.id, siteId } },
            select: { id: true, status: true },
          }),
        )
      : null;
    if (membership && (membership.status === "SUSPENDED" || membership.status === "REVOKED")) {
      return this.refuse(ctx, actor, "assign", "membership_inactive", null, siteId, {
        roleKey: role.key,
        assigneeUserId: user.id,
      });
    }
    const current = await inStaffContext(this.prisma, actor.token, (tx) =>
      tx.roleAssignment.findMany({
        where: { userId: user.id, role: { key: role.key }, siteId, revokedAt: null },
        select: { id: true, expiresAt: true },
      }),
    );
    const active = current.filter((a) => !a.expiresAt || a.expiresAt > now);
    if (active.some((a) => a.expiresAt === null)) {
      return this.refuse(ctx, actor, "assign", "already_assigned", null, siteId, {
        roleKey: role.key,
        assigneeUserId: user.id,
      });
    }
    const replaced = active[0]?.id ?? null;
    const roleRow = await this.prisma.role.findUniqueOrThrow({
      where: { key: role.key },
      select: { id: true },
    });
    try {
      const created = await inStaffContext(this.prisma, actor.token, async (tx) => {
        if (siteId) {
          // A site role works only with an ACTIVE membership; a pending invitee stays INVITED
          // until enrolment activates it.
          const status = user.status === "PENDING" ? "INVITED" : "ACTIVE";
          if (!membership) {
            await tx.membership.create({ data: { userId: user.id, siteId, status } });
          } else if (membership.status === "INVITED" && status === "ACTIVE") {
            await tx.membership.update({
              where: { id: membership.id },
              data: { status: "ACTIVE" },
            });
          }
        }
        for (const old of active) {
          await tx.roleAssignment.update({
            where: { id: old.id },
            data: {
              revokedAt: now,
              revokedById: actor.userId,
              reason: "Replaced by a new assignment",
            },
          });
        }
        const row = await tx.roleAssignment.create({
          data: {
            userId: user.id,
            roleId: roleRow.id,
            scopeType: role.scopeType,
            siteId,
            grantedById: actor.userId,
            grantedAt: now,
            expiresAt,
            reason: "Assigned in the admin console",
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          actorType: "USER",
          actorUserId: actor.userId,
          action: "iam.role_assigned",
          resourceType: "role_assignment",
          resourceId: row.id,
          scopeType: siteId ? "SITE" : "PLATFORM",
          siteId,
          outcome: "SUCCESS",
          metadata: {
            permission: "role_assignment:grant",
            roleKey: role.key,
            assigneeUserId: user.id,
            customerData: isCustomerDataRole(role),
            expiresAt: expiresAt?.toISOString() ?? null,
            replacedAssignmentId: replaced,
            membershipCreated: Boolean(siteId && !membership),
          },
          requestId: ctx.requestId,
        });
        return row;
      });
      return {
        assignment: {
          id: created.id,
          roleKey: role.key,
          roleName: role.name,
          scopeType: role.scopeType,
          siteId,
          grantedAt: now.toISOString(),
          expiresAt: expiresAt?.toISOString() ?? null,
          grantedBy: null,
          canRevoke: true,
        },
        replacedAssignmentId: replaced,
      };
    } catch (error) {
      if (isLastAdminDbError(error)) {
        return this.refuse(ctx, actor, "assign", "last_platform_admin", null, siteId, {
          roleKey: role.key,
        });
      }
      if (isIamDbRefusal(error)) {
        return this.refuse(ctx, actor, "assign", "db_guard", null, siteId, { roleKey: role.key });
      }
      throw error;
    }
  }

  // --- revoke -------------------------------------------------------------------------------

  async revoke(ctx: RequestContext, rawId: string, body: unknown): Promise<void> {
    const actor = await this.actor(ctx);
    const now = this.clock.now();
    const { reason } = parseBody(RevokeRoleRequestSchema, body);
    const row = UUID.test(rawId)
      ? await inStaffContext(this.prisma, actor.token, (tx) =>
          tx.roleAssignment.findUnique({
            where: { id: rawId.toLowerCase() },
            select: {
              id: true,
              userId: true,
              siteId: true,
              expiresAt: true,
              revokedAt: true,
              role: { select: { key: true } },
              user: { select: { kind: true } },
            },
          }),
        )
      : null;
    if (!row || row.user.kind !== "STAFF") {
      return this.refuse(ctx, actor, "revoke", "not_found", row?.id ?? null, null);
    }
    if (row.userId === (await loadSystemOwnerId(this.prisma))) {
      return this.refuse(ctx, actor, "revoke", "owner_target", row.id, row.siteId, {
        roleKey: row.role.key,
        assigneeUserId: row.userId,
      });
    }
    const target: Target = row.siteId ? { scope: "site", siteId: row.siteId } : PLATFORM;
    const others = await inStaffContext(this.prisma, actor.token, (tx) =>
      countOtherPlatformAdmins(tx, row.userId),
    );
    const decision = canRevokeRole(actor.snapshot, row.role.key, target, now, others);
    if (!decision.allowed) {
      return this.refuse(ctx, actor, "revoke", decision.reason, row.id, row.siteId, {
        roleKey: row.role.key,
      });
    }
    if (row.revokedAt || (row.expiresAt && row.expiresAt <= now)) {
      return this.refuse(ctx, actor, "revoke", "already_ended", row.id, row.siteId, {
        roleKey: row.role.key,
      });
    }
    try {
      await inStaffContext(this.prisma, actor.token, async (tx) => {
        const updated = await tx.roleAssignment.updateMany({
          where: { id: row.id, revokedAt: null },
          data: {
            revokedAt: now,
            revokedById: actor.userId,
            reason: reason || "Revoked in the admin console",
          },
        });
        if (updated.count !== 1) throw new ApiError("CONFLICT_STATE");
        await writeAudit(tx, {
          actorType: "USER",
          actorUserId: actor.userId,
          action: "iam.role_revoked",
          resourceType: "role_assignment",
          resourceId: row.id,
          scopeType: row.siteId ? "SITE" : "PLATFORM",
          siteId: row.siteId,
          outcome: "SUCCESS",
          metadata: {
            permission: "role_assignment:revoke",
            roleKey: row.role.key,
            assigneeUserId: row.userId,
            withReason: Boolean(reason),
          },
          requestId: ctx.requestId,
        });
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return this.refuse(ctx, actor, "revoke", "already_ended", row.id, row.siteId);
      }
      if (isLastAdminDbError(error)) {
        return this.refuse(ctx, actor, "revoke", "last_platform_admin", row.id, row.siteId);
      }
      if (isIamDbRefusal(error)) {
        return this.refuse(ctx, actor, "revoke", "db_guard", row.id, row.siteId);
      }
      throw error;
    }
  }
}
