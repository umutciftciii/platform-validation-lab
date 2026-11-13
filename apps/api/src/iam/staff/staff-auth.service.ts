/**
 * Staff sign-in and self-service (F1-002 Group 2, DP-011; ADR-013 D3, D5, D6, D8, D9; design
 * 3, 4, 5, 11.2).
 *
 * Login is two steps: the password yields a five-minute LOGIN_MFA_CHALLENGE in its own cookie
 * (not a session); the TOTP code or a recovery code turns it into a new session. Every login
 * failure (unknown e-mail, wrong password, not ACTIVE, not staff) returns the same 401, after the
 * same Argon2 work (NT-E1, NT-E2). The throttle is checked first: an early request gets 429
 * without the password being evaluated (D6, NT-T1).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  LoginRequestSchema,
  StaffMfaRequestSchema,
  StaffPasswordChangeRequestSchema,
  StaffPasswordResetRequestSchema,
  type RecoveryCodesResponse,
  type StaffLoginResponse,
  type StaffSessionListResponse,
  type StaffSessionResponse,
} from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import { maskEmail } from "../audit.js";
import {
  dummyVerify,
  hashPassword,
  passwordPolicyProblems,
  verifyPassword,
} from "../auth/password.js";
import {
  AuthThrottleService,
  STEP_UP_RULE,
  stepUpThrottleKey,
  throttledVerify,
  throttleKeys,
} from "../auth/throttle.js";
import { formatRecoveryCode, generateRecoveryCodes, hashRecoveryCode } from "../auth/tokens.js";
import type { Db } from "../db.js";
import { API_CONFIG, type ApiConfig } from "../http/api-config.js";
import { ApiError, parseBody } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import { challengeCookie, clearCookie, sessionCookie } from "../http/cookies.js";
import type { RequestContext } from "../http/request-context.js";
import { SESSION_POLICIES } from "../session-policy.js";
import { loadSystemOwnerId } from "../repository.js";
import { writeAudit } from "./audit-writer.js";
import {
  consumeToken,
  findLiveToken,
  issueCredentialToken,
  recordTokenFailure,
} from "./credentials.js";
import { useRecoveryCode, verifyUserTotp } from "./mfa.js";
import {
  StaffSessionService,
  isStepUpFresh,
  stepUpValidUntil,
  type ActiveSession,
} from "./sessions.js";

export interface AuthResult<T> {
  body: T;
  setCookies: string[];
}

/** Recovery codes left at or below this number: the UI warns (design 4.2). */
export const RECOVERY_CODES_LOW = 3;
/** One `iam.login_throttled` event per account bucket and window (design 8.7). */
const THROTTLE_AUDIT_WINDOW_MS = 10 * 60_000;

@Injectable()
export class StaffAuthService {
  private readonly throttle: AuthThrottleService;
  private readonly throttleAudited = new Map<string, number>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {
    this.throttle = new AuthThrottleService(prisma);
  }

  // --- login --------------------------------------------------------------------------------

  async login(ctx: RequestContext, body: unknown): Promise<AuthResult<StaffLoginResponse>> {
    const req = parseBody(LoginRequestSchema, body);
    const now = this.clock.now();
    const keys = throttleKeys(this.config.secrets.hmacKey, req.email, ctx.ipPrefix ?? "unknown");
    let user: {
      id: string;
      kind: string;
      status: string;
      passwordHash: string | null;
      securityVersion: number;
    } | null = null;
    let failure = "unknown_user";
    let rehash = false;

    const result = await throttledVerify(
      this.throttle,
      keys,
      SESSION_POLICIES.STAFF.throttle,
      now,
      async () => {
        user = await this.prisma.user.findUnique({
          where: { emailNormalized: req.email },
          select: { id: true, kind: true, status: true, passwordHash: true, securityVersion: true },
        });
        if (!user?.passwordHash) {
          await dummyVerify(req.password);
          failure = user ? "no_password" : "unknown_user";
          return false;
        }
        const verified = await verifyPassword(user.passwordHash, req.password);
        if (!verified.ok) failure = "wrong_password";
        else if (user.kind !== "STAFF") failure = "not_staff";
        else if (user.status !== "ACTIVE") failure = `status_${user.status.toLowerCase()}`;
        else {
          rehash = verified.needsRehash;
          return true;
        }
        return false;
      },
    );
    const found = user as { id: string; securityVersion: number } | null;
    const emailMasked = maskEmail(req.email);

    if (result.outcome === "throttled") {
      const last = this.throttleAudited.get(keys.account) ?? 0;
      if (now.getTime() - last >= THROTTLE_AUDIT_WINDOW_MS) {
        this.throttleAudited.set(keys.account, now.getTime());
        if (this.throttleAudited.size > 10_000) this.throttleAudited.clear();
        await writeAudit(this.prisma, {
          actorType: "SYSTEM",
          action: "iam.login_throttled",
          resourceType: "user",
          scopeType: "PLATFORM",
          outcome: "DENIED",
          metadata: { email: emailMasked, ipPrefix: ctx.ipPrefix },
          requestId: ctx.requestId,
        });
      }
      throw new ApiError("RATE_LIMITED", [], { "Retry-After": String(result.retryAfterSec) });
    }
    if (result.outcome === "failed" || !found) {
      await writeAudit(this.prisma, {
        actorType: "SYSTEM",
        action: "iam.login_failed",
        resourceType: "user",
        resourceId: found?.id ?? null,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason: failure,
        metadata: { email: emailMasked, ipPrefix: ctx.ipPrefix },
        requestId: ctx.requestId,
      });
      if (result.outcome === "failed" && result.attackSuspected) {
        await writeAudit(this.prisma, {
          actorType: "SYSTEM",
          action: "iam.login_attack_suspected",
          resourceType: "user",
          resourceId: found?.id ?? null,
          scopeType: "PLATFORM",
          outcome: "DENIED",
          metadata: { email: emailMasked },
          requestId: ctx.requestId,
        });
      }
      throw new ApiError("AUTH_INVALID_CREDENTIALS");
    }

    if (rehash) {
      await this.prisma.user.update({
        where: { id: found.id },
        data: { passwordHash: await hashPassword(req.password) },
      });
    }
    const challenge = await issueCredentialToken(this.prisma, {
      userId: found.id,
      purpose: "LOGIN_MFA_CHALLENGE",
      securityVersion: found.securityVersion,
      createdBy: { type: "SYSTEM" },
      now,
    });
    return { body: { next: "mfa" }, setCookies: [challengeCookie(challenge.token)] };
  }

  async loginMfa(ctx: RequestContext, body: unknown): Promise<AuthResult<undefined>> {
    const answer = parseBody(StaffMfaRequestSchema, body);
    const now = this.clock.now();
    const presentedChallenge = ctx.cookies.get(ADMIN_CHALLENGE_COOKIE);
    if (!presentedChallenge) {
      // DP-119: no challenge cookie at all. Usually the browser refused the Secure cookie of the
      // first step (Safari over plain http in local development), not an expired attempt; the
      // detail lets the sign-in page say so. It reveals nothing about any account.
      throw new ApiError("AUTH_CHALLENGE_EXPIRED", [{ path: "cookie", rule: "missing" }]);
    }
    const challenge = await findLiveToken(
      this.prisma,
      presentedChallenge,
      ["LOGIN_MFA_CHALLENGE"],
      now,
    );
    if (!challenge || challenge.user.status !== "ACTIVE") {
      throw new ApiError("AUTH_CHALLENGE_EXPIRED", [], {}, [ADMIN_CHALLENGE_COOKIE]);
    }
    const userId = challenge.user.id;
    let viaRecovery = false;
    let remaining: number | null = null;
    let ok: boolean;
    if ("code" in answer) {
      ok = await verifyUserTotp(
        this.prisma,
        this.config.secrets.mfaKeyring,
        userId,
        answer.code,
        now,
      );
    } else {
      viaRecovery = true;
      const used = await useRecoveryCode(
        this.prisma,
        this.config.secrets.hmacKey,
        userId,
        answer.recoveryCode,
        now,
      );
      ok = used.ok;
      remaining = used.remaining;
    }
    if (!ok) {
      await recordTokenFailure(this.prisma, challenge.id, now);
      await writeAudit(this.prisma, {
        actorType: "SYSTEM",
        action: "iam.mfa_challenge_failed",
        resourceType: "user",
        resourceId: userId,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason: viaRecovery ? "recovery_code" : "totp",
        requestId: ctx.requestId,
      });
      throw new ApiError("AUTH_MFA_INVALID");
    }

    const presented = await this.sessions.presented(ctx);
    const token = await this.prisma.$transaction(async (tx) => {
      if (!(await consumeToken(tx, challenge.id, now))) {
        throw new ApiError("AUTH_CHALLENGE_EXPIRED", [], {}, [ADMIN_CHALLENGE_COOKIE]);
      }
      if (presented) {
        await this.sessions.revoke(
          tx,
          presented.id,
          presented.userId === userId ? "ROTATED" : "LOGOUT",
          now,
        );
      }
      const t = await this.sessions.open(tx, {
        userId,
        securityVersion: challenge.user.securityVersion,
        // A recovery code proves possession of a backup, not of the authenticator: sensitive
        // actions still need a TOTP step-up.
        mfaVerifiedAt: viaRecovery ? null : now,
        ctx,
        now,
      });
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
      await writeAudit(tx, {
        actorType: "USER",
        actorUserId: userId,
        action: "iam.login_succeeded",
        resourceType: "user",
        resourceId: userId,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        metadata: { factor: viaRecovery ? "recovery_code" : "totp", ipPrefix: ctx.ipPrefix },
        requestId: ctx.requestId,
      });
      if (viaRecovery) {
        await writeAudit(tx, {
          actorType: "USER",
          actorUserId: userId,
          action: "iam.recovery_code_used",
          resourceType: "user",
          resourceId: userId,
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
          metadata: { remaining, low: (remaining ?? 0) <= RECOVERY_CODES_LOW },
          requestId: ctx.requestId,
        });
      }
      return t;
    });
    return {
      body: undefined,
      setCookies: [sessionCookie(token), clearCookie(ADMIN_CHALLENGE_COOKIE)],
    };
  }

  async logout(ctx: RequestContext): Promise<AuthResult<undefined>> {
    const now = this.clock.now();
    const session = await this.sessions.find(ctx);
    if (session && (await this.sessions.revoke(this.prisma, session.id, "LOGOUT", now))) {
      await writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: session.userId,
        action: "iam.logout",
        resourceType: "session",
        resourceId: session.id,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        requestId: ctx.requestId,
      });
    }
    return {
      body: undefined,
      setCookies: [clearCookie(ADMIN_SESSION_COOKIE), clearCookie(ADMIN_CHALLENGE_COOKIE)],
    };
  }

  // --- session ------------------------------------------------------------------------------

  async session(ctx: RequestContext): Promise<StaffSessionResponse> {
    const s = await this.sessions.require(ctx);
    const until = stepUpValidUntil(s.mfaVerifiedAt);
    const now = this.clock.now();
    return {
      user: { id: s.user.id, email: s.user.email, displayName: s.user.displayName },
      mfaVerifiedAt: s.mfaVerifiedAt?.toISOString() ?? null,
      stepUpValidUntil: until && until > now ? until.toISOString() : null,
      idleExpiresAt: s.idleExpiresAt.toISOString(),
      absoluteExpiresAt: s.absoluteExpiresAt.toISOString(),
      // DP-110: only tells the user about itself; nobody learns who the owner is.
      isSystemOwner: (await loadSystemOwnerId(this.prisma)) === s.user.id,
    };
  }

  /** 403 AUTH_STEP_UP_REQUIRED unless the session's MFA verification is fresh (D8). */
  requireStepUp(session: ActiveSession): void {
    if (!isStepUpFresh(session.mfaVerifiedAt, this.clock.now())) {
      throw new ApiError("AUTH_STEP_UP_REQUIRED");
    }
  }

  private async stepUpGate(userId: string, now: Date): Promise<string> {
    const key = stepUpThrottleKey(this.config.secrets.hmacKey, userId);
    const check = await this.throttle.checkKeys([key], now);
    if (!check.allowed) {
      throw new ApiError("RATE_LIMITED", [], { "Retry-After": String(check.retryAfterSec) });
    }
    return key;
  }

  async stepUp(ctx: RequestContext, body: unknown): Promise<AuthResult<undefined>> {
    const session = await this.sessions.require(ctx);
    const answer = parseBody(StaffMfaRequestSchema, body);
    const now = this.clock.now();
    const key = await this.stepUpGate(session.userId, now);
    const audit = (outcome: "SUCCESS" | "DENIED", reason?: string) =>
      writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: session.userId,
        action: outcome === "SUCCESS" ? "iam.step_up_succeeded" : "iam.step_up_failed",
        resourceType: "session",
        resourceId: session.id,
        scopeType: "PLATFORM",
        outcome,
        reason: reason ?? null,
        requestId: ctx.requestId,
      });
    // Recovery codes are for losing the authenticator, not for step-up (design 4.2, NT-M4).
    const ok =
      "code" in answer &&
      (await verifyUserTotp(
        this.prisma,
        this.config.secrets.mfaKeyring,
        session.userId,
        answer.code,
        now,
      ));
    if (!ok) {
      await this.throttle.recordSingleFailure(key, STEP_UP_RULE, now);
      await audit("DENIED", "code" in answer ? "totp" : "recovery_code_not_accepted");
      throw new ApiError("AUTH_MFA_INVALID");
    }
    await this.throttle.clear([key]);
    const token = await this.prisma.$transaction(async (tx) => {
      if (!(await this.sessions.revoke(tx, session.id, "ROTATED", now))) {
        throw new ApiError("AUTH_SESSION_REQUIRED", [], {}, [ADMIN_SESSION_COOKIE]);
      }
      return this.sessions.open(tx, {
        userId: session.userId,
        securityVersion: session.securityVersion,
        mfaVerifiedAt: now,
        ctx,
        now,
        rotatedFrom: { id: session.id, absoluteExpiresAt: session.absoluteExpiresAt },
      });
    });
    await audit("SUCCESS");
    return { body: undefined, setCookies: [sessionCookie(token)] };
  }

  // --- devices ------------------------------------------------------------------------------

  async listSessions(ctx: RequestContext): Promise<StaffSessionListResponse> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const rows = await this.prisma.session.findMany({
      where: this.sessions.liveWhere(session.userId, now),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, lastSeenAt: true, ipPrefix: true, userAgent: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        ipPrefix: r.ipPrefix,
        userAgent: r.userAgent,
        current: r.id === session.id,
      })),
    };
  }

  /** Signs out one of the caller's own sessions; anything else is 404 (NT-S8). */
  async revokeOwnSession(ctx: RequestContext, id: string): Promise<AuthResult<undefined>> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const target = UUID.test(id)
      ? await this.prisma.session.findFirst({
          where: { id, ...this.sessions.liveWhere(session.userId, now) },
          select: { id: true },
        })
      : null;
    if (!target || !(await this.sessions.revoke(this.prisma, target.id, "USER_REVOKED", now))) {
      throw new ApiError("NOT_FOUND");
    }
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: session.userId,
      action: "iam.session_revoked",
      resourceType: "session",
      resourceId: target.id,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      metadata: { self: true, current: target.id === session.id },
      requestId: ctx.requestId,
    });
    return {
      body: undefined,
      setCookies: target.id === session.id ? [clearCookie(ADMIN_SESSION_COOKIE)] : [],
    };
  }

  async revokeOtherSessions(ctx: RequestContext): Promise<void> {
    const session = await this.sessions.require(ctx);
    this.requireStepUp(session);
    const now = this.clock.now();
    const count = await this.sessions.revokeAll(
      this.prisma,
      session.userId,
      "USER_REVOKED",
      now,
      session.id,
    );
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: session.userId,
      action: "iam.sessions_revoked_all",
      resourceType: "user",
      resourceId: session.userId,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      metadata: { revokedCount: count, keptCurrent: true },
      requestId: ctx.requestId,
    });
  }

  // --- passwords ----------------------------------------------------------------------------

  async changePassword(ctx: RequestContext, body: unknown): Promise<AuthResult<undefined>> {
    const session = await this.sessions.require(ctx);
    this.requireStepUp(session);
    const req = parseBody(StaffPasswordChangeRequestSchema, body);
    const now = this.clock.now();
    const key = await this.stepUpGate(session.userId, now);
    const current = session.user.passwordHash
      ? await verifyPassword(session.user.passwordHash, req.currentPassword)
      : { ok: false };
    if (!current.ok) {
      await this.throttle.recordSingleFailure(key, STEP_UP_RULE, now);
      await writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: session.userId,
        action: "iam.password_changed",
        resourceType: "user",
        resourceId: session.userId,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason: "wrong_current_password",
        requestId: ctx.requestId,
      });
      throw new ApiError("AUTH_INVALID_CREDENTIALS");
    }
    const problems = passwordPolicyProblems(req.newPassword, {
      kind: "STAFF",
      hasMfa: true,
      email: session.user.email,
      displayName: session.user.displayName,
    });
    if (problems.length) throw new ApiError("AUTH_PASSWORD_POLICY", problems);
    const hash = await hashPassword(req.newPassword);
    const token = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: session.userId },
        data: {
          passwordHash: hash,
          passwordUpdatedAt: now,
          securityVersion: { increment: 1 },
        },
        select: { securityVersion: true },
      });
      await this.sessions.revoke(tx, session.id, "ROTATED", now);
      const others = await this.sessions.revokeAll(tx, session.userId, "SECURITY_VERSION", now);
      const t = await this.sessions.open(tx, {
        userId: session.userId,
        securityVersion: user.securityVersion,
        mfaVerifiedAt: session.mfaVerifiedAt,
        ctx,
        now,
        rotatedFrom: { id: session.id, absoluteExpiresAt: session.absoluteExpiresAt },
      });
      await writeAudit(tx, {
        actorType: "USER",
        actorUserId: session.userId,
        action: "iam.password_changed",
        resourceType: "user",
        resourceId: session.userId,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        metadata: { otherDevicesSignedOut: others },
        requestId: ctx.requestId,
      });
      return t;
    });
    await this.throttle.clear([key]);
    return { body: undefined, setCookies: [sessionCookie(token)] };
  }

  /**
   * Password reset with an operator link (`iam-cli reset-link`, until DP-E). Needs a TOTP code or
   * a recovery code (D9, NT-M5). Every session of the user ends (securityVersion + 1).
   */
  async resetPassword(ctx: RequestContext, body: unknown): Promise<void> {
    const req = parseBody(StaffPasswordResetRequestSchema, body);
    const now = this.clock.now();
    const token = await findLiveToken(this.prisma, req.token, ["PASSWORD_RESET"], now);
    if (!token || token.user.status !== "ACTIVE") throw new ApiError("AUTH_TOKEN_INVALID");
    const userId = token.user.id;
    const problems = passwordPolicyProblems(req.newPassword, {
      kind: "STAFF",
      hasMfa: true,
      email: token.user.email,
      displayName: token.user.displayName,
    });
    if (problems.length) throw new ApiError("AUTH_PASSWORD_POLICY", problems);

    let ok = false;
    let viaRecovery = false;
    if (req.code !== undefined && req.recoveryCode === undefined) {
      ok = await verifyUserTotp(this.prisma, this.config.secrets.mfaKeyring, userId, req.code, now);
    } else if (req.recoveryCode !== undefined && req.code === undefined) {
      viaRecovery = true;
      ok = (
        await useRecoveryCode(
          this.prisma,
          this.config.secrets.hmacKey,
          userId,
          req.recoveryCode,
          now,
        )
      ).ok;
    }
    if (!ok) {
      await recordTokenFailure(this.prisma, token.id, now);
      await writeAudit(this.prisma, {
        actorType: "SYSTEM",
        action: "iam.password_reset_completed",
        resourceType: "user",
        resourceId: userId,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason: "second_factor",
        requestId: ctx.requestId,
      });
      throw new ApiError("AUTH_MFA_INVALID");
    }
    const hash = await hashPassword(req.newPassword);
    await this.prisma.$transaction(async (tx) => {
      if (!(await consumeToken(tx, token.id, now))) throw new ApiError("AUTH_TOKEN_INVALID");
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hash, passwordUpdatedAt: now, securityVersion: { increment: 1 } },
      });
      const revoked = await this.sessions.revokeAll(tx, userId, "SECURITY_VERSION", now);
      await writeAudit(tx, {
        actorType: "USER",
        actorUserId: userId,
        action: "iam.password_reset_completed",
        resourceType: "user",
        resourceId: userId,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        metadata: { factor: viaRecovery ? "recovery_code" : "totp", revokedCount: revoked },
        requestId: ctx.requestId,
      });
    });
  }

  async regenerateRecoveryCodes(ctx: RequestContext): Promise<RecoveryCodesResponse> {
    const session = await this.sessions.require(ctx);
    this.requireStepUp(session);
    const now = this.clock.now();
    const codes = await this.prisma.$transaction((tx) =>
      replaceRecoveryCodes(tx, this.config.secrets.hmacKey, session.userId, now),
    );
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: session.userId,
      action: "iam.recovery_codes_regenerated",
      resourceType: "user",
      resourceId: session.userId,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      requestId: ctx.requestId,
    });
    return { codes };
  }
}

/** Deletes the user's recovery codes and stores ten new ones; returns them formatted, once. */
export async function replaceRecoveryCodes(
  db: Db,
  hmacKey: Buffer,
  userId: string,
  now: Date,
): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.mfaRecoveryCode.deleteMany({ where: { userId } });
  await db.mfaRecoveryCode.createMany({
    data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(hmacKey, c), createdAt: now })),
  });
  return codes.map(formatRecoveryCode);
}
