/**
 * Staff administration endpoints (F1-002 Group 2, DP-011; ADR-013 D10, D11, D12; design 4.4,
 * 10.3, 10.5, 11.3).
 *
 * Guard order for every endpoint: proxy key -> CSRF (middleware) -> session -> step-up (every
 * administration action is sensitive) -> target loaded (missing: 404) -> `canActOnUser`
 * (permission at the request target, visibility 404, self, staff only, dominance, ancestry,
 * state, last administrator) -> the action and its audit event in one transaction. Every refusal
 * is audited as DENIED with the internal reason, which never reaches the client (NT-R9).
 *
 * The database repeats the last-administrator rule (`User_last_platform_admin`,
 * `RoleAssignment_last_platform_admin`) and writes its own `db.*` audit trail.
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ADMIN_SESSION_COOKIE,
  DeactivateRequestSchema,
  InviteUserRequestSchema,
  MfaResetRequestSchema,
  ReasonRequestSchema,
  SuspendRequestSchema,
  type EnrolmentLinkResponse,
  type InviteUserResponse,
  type MfaResetResponse,
} from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  decide,
  heldPermissions,
  isGrantActive,
  type AuthorizationSnapshot,
  type Target,
} from "../authorization.js";
import { AuthThrottleService, throttleKeys } from "../auth/throttle.js";
import { PERMISSION_BY_KEY, ROLE_BY_KEY } from "../catalog.js";
import type { Db } from "../db.js";
import { canActOnUser, canAssignRole, type ActDecision, type ActTarget } from "../escalation.js";
import { API_CONFIG, type ApiConfig } from "../http/api-config.js";
import { ApiError, parseBody } from "../http/api-error.js";
import { Clock, FaultInjector } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import {
  countQualifiedPlatformAdmins,
  loadActTarget,
  loadAuthorizationSnapshot,
  loadGrantAncestry,
} from "../repository.js";
import { inStaffContext, userOpenRows } from "../iam-context.js";
import { writeAudit } from "./audit-writer.js";
import { enrolmentLink, invalidateUserTokens, issueCredentialToken } from "./credentials.js";
import { StaffSessionService, isStepUpFresh, type ActiveSession } from "./sessions.js";

const AUDIT_ACTION: Readonly<Record<string, string>> = {
  "user:invite": "iam.user_invited",
  "mfa:reset": "iam.mfa_reset",
  "user:suspend": "iam.user_suspended",
  "user:reactivate": "iam.user_reactivated",
  "user:unlock": "iam.user_unlocked",
  "session:revoke": "iam.session_revoked",
  "user:deactivate": "iam.user_deactivated",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST_ADMIN_DB = /last active platform administrator/i;

/** A database refusal from the last-administrator triggers (F1-001A). */
export function isLastAdminDbError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && LAST_ADMIN_DB.test(msg)) return true;
    const meta = (e as { meta?: unknown }).meta;
    if (meta && LAST_ADMIN_DB.test(JSON.stringify(meta))) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

interface Actor {
  session: ActiveSession;
  snapshot: AuthorizationSnapshot;
  /** The raw admin session token: the database context of every IAM read and write (DP-125). */
  token: string;
}

interface Denial {
  action: string;
  reason: string;
  error: ApiError;
}

@Injectable()
export class UserAdminService {
  private readonly throttle: AuthThrottleService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
    @Inject(FaultInjector) private readonly faults: FaultInjector,
  ) {
    this.throttle = new AuthThrottleService(prisma);
  }

  // --- shared guard steps ---------------------------------------------------------------------

  private async actor(ctx: RequestContext, permission: string): Promise<Actor> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const fresh = isStepUpFresh(session.mfaVerifiedAt, now);
    const token = ctx.cookies.get(ADMIN_SESSION_COOKIE) ?? "";
    const snapshot = await inStaffContext(this.prisma, token, async (tx) => {
      const snap = await loadAuthorizationSnapshot(tx, session.userId, { mfaVerified: fresh });
      if (snap && fresh) snap.grantAncestry = await loadGrantAncestry(tx);
      return snap;
    });
    if (!snapshot) throw new ApiError("AUTH_SESSION_REQUIRED");
    if (!fresh) {
      await this.audit(ctx, session.userId, permission, null, null, "DENIED", "step_up_required");
      throw new ApiError("AUTH_STEP_UP_REQUIRED");
    }
    return { session, snapshot, token };
  }

  private audit(
    ctx: RequestContext,
    actorUserId: string,
    permission: string,
    targetId: string | null,
    requestTarget: Target | null,
    outcome: "SUCCESS" | "DENIED",
    reason: string | null,
    metadata: Record<string, unknown> = {},
    db: Db = this.prisma,
    action = AUDIT_ACTION[permission] ?? "iam.user_admin",
  ): Promise<void> {
    const site = requestTarget?.scope === "site" ? requestTarget.siteId : null;
    return writeAudit(db, {
      actorType: "USER",
      actorUserId,
      action,
      resourceType: "user",
      resourceId: targetId,
      scopeType: site ? "SITE" : "PLATFORM",
      siteId: site,
      outcome,
      reason,
      metadata: { permission, ...metadata },
      requestId: ctx.requestId,
    });
  }

  private async deny(
    ctx: RequestContext,
    actor: Actor,
    permission: string,
    targetId: string | null,
    requestTarget: Target | null,
    denial: Omit<Denial, "action">,
  ): Promise<never> {
    await this.audit(
      ctx,
      actor.session.userId,
      permission,
      targetId,
      requestTarget,
      "DENIED",
      denial.reason,
    );
    throw denial.error;
  }

  private static errorFor(decision: Extract<ActDecision, { allowed: false }>): ApiError {
    if (decision.reason === "mfa_required") return new ApiError("AUTH_STEP_UP_REQUIRED");
    if (decision.reason === "last_platform_admin") return new ApiError("CONFLICT_LAST_ADMIN");
    if (decision.status === 404) return new ApiError("NOT_FOUND");
    if (decision.status === 409) return new ApiError("CONFLICT_STATE");
    return new ApiError("FORBIDDEN");
  }

  /**
   * The scope a request acts in: the named site; the platform when the permission is platform-
   * scoped or held platform-wide; otherwise a site of the target where the actor holds it; else
   * any site where the actor holds it (so an out-of-scope target answers 404, NT-R2).
   */
  private requestTarget(
    actor: Actor,
    target: ActTarget,
    permission: string,
    siteId?: string,
  ): Target {
    const platform: Target = { scope: "platform" };
    if (siteId) return { scope: "site", siteId };
    const now = this.clock.now();
    if (PERMISSION_BY_KEY.get(permission)?.scopeType === "PLATFORM") return platform;
    if (heldPermissions(actor.snapshot, platform, now).has(permission)) return platform;
    const targetSites = new Set(target.membershipSiteIds);
    for (const g of target.grants) if (g.siteId && isGrantActive(g, now)) targetSites.add(g.siteId);
    const holds = (s: string) =>
      heldPermissions(actor.snapshot, { scope: "site", siteId: s }, now).has(permission);
    for (const s of targetSites) if (holds(s)) return { scope: "site", siteId: s };
    for (const s of actor.snapshot.activeMembershipSiteIds) {
      if (holds(s)) return { scope: "site", siteId: s };
    }
    return platform;
  }

  /** Loads the target and runs `canActOnUser`; denies (audited) or returns what the action needs. */
  private async authorizeOnTarget(
    ctx: RequestContext,
    permission: string,
    targetId: string,
    siteId?: string,
  ): Promise<{ actor: Actor; target: ActTarget; requestTarget: Target }> {
    const actor = await this.actor(ctx, permission);
    // DP-125: the target and the administrator count come from the database in this session's
    // context (row-level security; the superiority rule needs the target's roles everywhere).
    const loaded = UUID.test(targetId)
      ? await inStaffContext(this.prisma, actor.token, async (tx) => {
          const t = await loadActTarget(tx, targetId);
          return t
            ? { target: t, remaining: await countQualifiedPlatformAdmins(tx, [t.userId]) }
            : null;
        })
      : null;
    const target = loaded?.target ?? null;
    if (!target) {
      return this.deny(ctx, actor, permission, null, null, {
        reason: "not_found",
        error: new ApiError("NOT_FOUND"),
      });
    }
    const requestTarget = this.requestTarget(actor, target, permission, siteId);
    if (requestTarget.scope === "site") {
      const site = await this.prisma.site.findUnique({
        where: { id: requestTarget.siteId },
        select: { id: true },
      });
      if (!site) {
        return this.deny(ctx, actor, permission, target.userId, null, {
          reason: "unknown_site",
          error: new ApiError("NOT_FOUND"),
        });
      }
    }
    const remaining = loaded?.remaining;
    const decision = canActOnUser(actor.snapshot, target, permission, requestTarget, {
      now: this.clock.now(),
      remainingQualifiedPlatformAdmins: remaining,
    });
    if (!decision.allowed) {
      return this.deny(ctx, actor, permission, target.userId, requestTarget, {
        reason: decision.reason,
        error: UserAdminService.errorFor(decision),
      });
    }
    return { actor, target, requestTarget };
  }

  /** Runs the action; a last-administrator trigger refusal becomes 409 and is audited. */
  private async guarded<T>(
    ctx: RequestContext,
    actor: Actor,
    permission: string,
    targetId: string,
    requestTarget: Target,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isLastAdminDbError(error)) {
        return this.deny(ctx, actor, permission, targetId, requestTarget, {
          reason: "last_platform_admin_db",
          error: new ApiError("CONFLICT_LAST_ADMIN"),
        });
      }
      throw error;
    }
  }

  // --- invite and enrolment link --------------------------------------------------------------

  async invite(ctx: RequestContext, body: unknown): Promise<InviteUserResponse> {
    const actor = await this.actor(ctx, "user:invite");
    const req = parseBody(InviteUserRequestSchema, body);
    const now = this.clock.now();
    const siteTarget: Target = { scope: "site", siteId: req.siteId };
    const site = await this.prisma.site.findUnique({
      where: { id: req.siteId },
      select: { id: true },
    });
    if (!site) {
      return this.deny(ctx, actor, "user:invite", null, null, {
        reason: "unknown_site",
        error: new ApiError("NOT_FOUND"),
      });
    }
    const may = decide(actor.snapshot, "user:invite", siteTarget, now);
    if (!may.allowed) {
      return this.deny(ctx, actor, "user:invite", null, siteTarget, {
        reason: may.reason,
        error: new ApiError(may.reason === "mfa_required" ? "AUTH_STEP_UP_REQUIRED" : "FORBIDDEN"),
      });
    }
    const newUserId = randomUUID();
    const role = req.roleKey ? ROLE_BY_KEY.get(req.roleKey) : undefined;
    if (req.roleKey && !role) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "roleKey", rule: "unknown_role" }]);
    }
    const roleTarget: Target | null = role
      ? role.scopeType === "PLATFORM"
        ? { scope: "platform" }
        : siteTarget
      : null;
    if (role && roleTarget) {
      const grant = canAssignRole(
        actor.snapshot,
        { userId: newUserId, kind: "STAFF", status: "PENDING" },
        role.key,
        roleTarget,
        now,
      );
      if (!grant.allowed) {
        return this.deny(ctx, actor, "user:invite", null, siteTarget, {
          reason: `role_${grant.reason}`,
          error: new ApiError(
            grant.reason === "mfa_required" ? "AUTH_STEP_UP_REQUIRED" : "FORBIDDEN",
          ),
        });
      }
    }
    const exists = await this.prisma.user.findUnique({
      where: { emailNormalized: req.email },
      select: { id: true },
    });
    if (exists) {
      return this.deny(ctx, actor, "user:invite", exists.id, siteTarget, {
        reason: "email_exists",
        error: new ApiError("CONFLICT_STATE"),
      });
    }
    const token = await inStaffContext(this.prisma, actor.token, async (tx) => {
      await tx.user.create({
        data: {
          id: newUserId,
          email: req.email,
          emailNormalized: req.email,
          kind: "STAFF",
          status: "PENDING",
          displayName: req.displayName,
        },
      });
      await tx.membership.create({
        data: { userId: newUserId, siteId: req.siteId, status: "INVITED" },
      });
      if (role && roleTarget) {
        const roleRow = await tx.role.findUniqueOrThrow({ where: { key: role.key } });
        await tx.roleAssignment.create({
          data: {
            userId: newUserId,
            roleId: roleRow.id,
            scopeType: role.scopeType,
            siteId: roleTarget.scope === "site" ? roleTarget.siteId : null,
            grantedById: actor.session.userId,
            reason: "granted with the invitation",
          },
        });
      }
      const issued = await issueCredentialToken(tx, {
        userId: newUserId,
        purpose: "STAFF_INVITE",
        securityVersion: 0,
        createdBy: { type: "USER", userId: actor.session.userId },
        now,
      });
      await this.audit(
        ctx,
        actor.session.userId,
        "user:invite",
        newUserId,
        siteTarget,
        "SUCCESS",
        null,
        {
          email: req.email,
          role: role?.key ?? null,
          roleScope: roleTarget?.scope ?? null,
        },
        tx,
      );
      return issued.token;
    });
    return { userId: newUserId, enrolmentLink: enrolmentLink(this.config.adminBaseUrl, token) };
  }

  /** A new link for an invited user who never activated; the old link stops working (NT-K3). */
  async enrolmentLink(ctx: RequestContext, targetId: string): Promise<EnrolmentLinkResponse> {
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "user:invite",
      targetId,
    );
    const now = this.clock.now();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
      select: { status: true, emailVerifiedAt: true, securityVersion: true },
    });
    if (user.status !== "PENDING" || user.emailVerifiedAt !== null) {
      return this.deny(ctx, actor, "user:invite", target.userId, requestTarget, {
        reason: "not_an_invitation",
        error: new ApiError("CONFLICT_STATE"),
      });
    }
    const token = await this.prisma.$transaction(async (tx) => {
      const issued = await issueCredentialToken(tx, {
        userId: target.userId,
        purpose: "STAFF_INVITE",
        securityVersion: user.securityVersion,
        createdBy: { type: "USER", userId: actor.session.userId },
        now,
      });
      await this.audit(
        ctx,
        actor.session.userId,
        "user:invite",
        target.userId,
        requestTarget,
        "SUCCESS",
        null,
        {
          reissued: true,
        },
        tx,
        "iam.enrol_link_issued",
      );
      return issued.token;
    });
    return { enrolmentLink: enrolmentLink(this.config.adminBaseUrl, token) };
  }

  // --- MFA reset ----------------------------------------------------------------------------

  async mfaReset(ctx: RequestContext, targetId: string, body: unknown): Promise<MfaResetResponse> {
    const req = parseBody(MfaResetRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "mfa:reset",
      targetId,
    );
    if (target.status !== "ACTIVE") {
      return this.deny(ctx, actor, "mfa:reset", target.userId, requestTarget, {
        reason: "target_not_active",
        error: new ApiError("CONFLICT_STATE"),
      });
    }
    const now = this.clock.now();
    const token = await this.prisma.$transaction(async (tx) => {
      await tx.mfaFactor.deleteMany({ where: { userId: target.userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: target.userId } });
      const user = await tx.user.update({
        where: { id: target.userId },
        data: { status: "PENDING", mfaEnrolledAt: null, securityVersion: { increment: 1 } },
        select: { securityVersion: true },
      });
      const revoked = await this.sessions.revokeAll(tx, target.userId, "SECURITY_VERSION", now);
      await invalidateUserTokens(tx, target.userId, now);
      const issued = await issueCredentialToken(tx, {
        userId: target.userId,
        purpose: "MFA_REENROLMENT",
        securityVersion: user.securityVersion,
        createdBy: { type: "USER", userId: actor.session.userId },
        now,
      });
      await this.audit(
        ctx,
        actor.session.userId,
        "mfa:reset",
        target.userId,
        requestTarget,
        "SUCCESS",
        req.reason,
        {
          verificationMethod: req.verificationMethod,
          revokedCount: revoked,
        },
        tx,
      );
      return issued.token;
    });
    return { reenrolmentLink: enrolmentLink(this.config.adminBaseUrl, token) };
  }

  // --- suspend / reactivate -------------------------------------------------------------------

  async suspend(ctx: RequestContext, targetId: string, body: unknown): Promise<void> {
    const req = parseBody(SuspendRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "user:suspend",
      targetId,
      req.siteId,
    );
    const now = this.clock.now();
    await this.guarded(ctx, actor, "user:suspend", target.userId, requestTarget, () =>
      inStaffContext(this.prisma, actor.token, async (tx) => {
        if (requestTarget.scope === "site") {
          const { count } = await tx.membership.updateMany({
            where: {
              userId: target.userId,
              siteId: requestTarget.siteId,
              status: { in: ["ACTIVE", "INVITED"] },
            },
            data: { status: "SUSPENDED" },
          });
          if (count !== 1) throw new ApiError("CONFLICT_STATE");
          await this.audit(
            ctx,
            actor.session.userId,
            "user:suspend",
            target.userId,
            requestTarget,
            "SUCCESS",
            req.reason,
            {},
            tx,
            "iam.membership_suspended",
          );
          return;
        }
        const { count } = await tx.user.updateMany({
          where: { id: target.userId, status: { in: ["ACTIVE", "PENDING"] } },
          data: { status: "SUSPENDED", securityVersion: { increment: 1 } },
        });
        if (count !== 1) throw new ApiError("CONFLICT_STATE");
        const revoked = await this.sessions.revokeAll(tx, target.userId, "SECURITY_VERSION", now);
        await invalidateUserTokens(tx, target.userId, now);
        await this.audit(
          ctx,
          actor.session.userId,
          "user:suspend",
          target.userId,
          requestTarget,
          "SUCCESS",
          req.reason,
          {
            revokedCount: revoked,
          },
          tx,
        );
      }),
    ).catch(async (error: unknown) => {
      if (error instanceof ApiError && error.code === "CONFLICT_STATE") {
        await this.audit(
          ctx,
          actor.session.userId,
          "user:suspend",
          target.userId,
          requestTarget,
          "DENIED",
          "invalid_state",
        );
      }
      throw error;
    });
  }

  async reactivate(ctx: RequestContext, targetId: string, body: unknown): Promise<void> {
    const req = parseBody(SuspendRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "user:reactivate",
      targetId,
      req.siteId,
    );
    await inStaffContext(this.prisma, actor.token, async (tx) => {
      if (requestTarget.scope === "site") {
        const { count } = await tx.membership.updateMany({
          where: { userId: target.userId, siteId: requestTarget.siteId, status: "SUSPENDED" },
          data: { status: "ACTIVE" },
        });
        if (count !== 1) throw new ApiError("CONFLICT_STATE");
      } else {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: target.userId },
          select: { passwordHash: true, mfaEnrolledAt: true, emailVerifiedAt: true },
        });
        // An account suspended before it finished enrolment goes back to PENDING.
        const enrolled = user.passwordHash && user.mfaEnrolledAt && user.emailVerifiedAt;
        const { count } = await tx.user.updateMany({
          where: { id: target.userId, status: "SUSPENDED" },
          data: { status: enrolled ? "ACTIVE" : "PENDING" },
        });
        if (count !== 1) throw new ApiError("CONFLICT_STATE");
      }
      await this.audit(
        ctx,
        actor.session.userId,
        "user:reactivate",
        target.userId,
        requestTarget,
        "SUCCESS",
        req.reason,
        {},
        tx,
      );
    }).catch(async (error: unknown) => {
      if (error instanceof ApiError && error.code === "CONFLICT_STATE") {
        await this.audit(
          ctx,
          actor.session.userId,
          "user:reactivate",
          target.userId,
          requestTarget,
          "DENIED",
          "invalid_state",
        );
      }
      throw error;
    });
  }

  // --- unlock and session revocation ----------------------------------------------------------

  async unlock(ctx: RequestContext, targetId: string, body: unknown): Promise<void> {
    const req = parseBody(ReasonRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "user:unlock",
      targetId,
    );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
      select: { emailNormalized: true },
    });
    const keys = throttleKeys(this.config.secrets.hmacKey, user.emailNormalized, "-");
    const removed = await this.throttle.unlock(keys.account);
    await this.audit(
      ctx,
      actor.session.userId,
      "user:unlock",
      target.userId,
      requestTarget,
      "SUCCESS",
      req.reason,
      {
        bucketsRemoved: removed,
      },
    );
  }

  async revokeSessions(ctx: RequestContext, targetId: string, body: unknown): Promise<void> {
    const req = parseBody(ReasonRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "session:revoke",
      targetId,
    );
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const count = await this.sessions.revokeAll(tx, target.userId, "ADMIN_REVOKED", now);
      await this.audit(
        ctx,
        actor.session.userId,
        "session:revoke",
        target.userId,
        requestTarget,
        "SUCCESS",
        req.reason,
        {
          revokedCount: count,
        },
        tx,
      );
    });
  }

  // --- deactivate (terminal) --------------------------------------------------------------------

  async deactivate(ctx: RequestContext, targetId: string, body: unknown): Promise<void> {
    const req = parseBody(DeactivateRequestSchema, body);
    const { actor, target, requestTarget } = await this.authorizeOnTarget(
      ctx,
      "user:deactivate",
      targetId,
    );
    const now = this.clock.now();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
      select: { emailNormalized: true },
    });
    if (user.emailNormalized !== req.confirmEmail) {
      return this.deny(ctx, actor, "user:deactivate", target.userId, requestTarget, {
        reason: "confirm_email_mismatch",
        error: new ApiError("CONFIRMATION_MISMATCH", [{ path: "confirmEmail", rule: "mismatch" }]),
      });
    }
    const stepUpAgeSec = actor.session.mfaVerifiedAt
      ? Math.round((now.getTime() - actor.session.mfaVerifiedAt.getTime()) / 1000)
      : null;
    await this.guarded(ctx, actor, "user:deactivate", target.userId, requestTarget, () =>
      inStaffContext(this.prisma, actor.token, async (tx) => {
        // Assignments first: the last-administrator trigger judges them before the user row.
        const roles = await tx.roleAssignment.findMany({
          where: { userId: target.userId, revokedAt: null },
          select: { id: true, scopeType: true, siteId: true, role: { select: { key: true } } },
        });
        await tx.roleAssignment.updateMany({
          where: { userId: target.userId, revokedAt: null },
          data: { revokedAt: now, revokedById: actor.session.userId },
        });
        this.faults.check("deactivate:after-roles");
        const revoked = await this.sessions.revokeAll(tx, target.userId, "SECURITY_VERSION", now);
        const tokens = await invalidateUserTokens(tx, target.userId, now);
        const memberships = await tx.membership.updateMany({
          where: { userId: target.userId, status: { not: "REVOKED" } },
          data: { status: "REVOKED" },
        });
        // DP-125 (condition 4): row-level security must not have hidden a row from the bulk
        // updates above; any open row left behind aborts the whole deactivation.
        const open = await userOpenRows(tx, target.userId);
        if (open.roles !== 0 || open.memberships !== 0) {
          throw new ApiError("CONFLICT_STATE");
        }
        this.faults.check("deactivate:before-user");
        await tx.user.update({
          where: { id: target.userId },
          data: { status: "DEACTIVATED", securityVersion: { increment: 1 } },
        });
        await this.audit(
          ctx,
          actor.session.userId,
          "user:deactivate",
          target.userId,
          requestTarget,
          "SUCCESS",
          req.reason,
          {
            roles: roles.map((r) => ({ role: r.role.key, scope: r.scopeType, siteId: r.siteId })),
            revokedCount: revoked,
            tokensInvalidated: tokens,
            membershipsRevoked: memberships.count,
            stepUpAgeSec,
          },
          tx,
        );
      }),
    );
  }
}
