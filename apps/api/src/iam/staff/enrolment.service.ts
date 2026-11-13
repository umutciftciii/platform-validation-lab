/**
 * Staff enrolment with a single-use link (F1-002 Group 2; ADR-013 D9; design 4.4, 6).
 *
 * One flow for four token purposes:
 *
 * | Purpose          | Issued by                          | Password step              |
 * | ---------------- | ---------------------------------- | -------------------------- |
 * | ADMIN_ENROLMENT  | `iam-cli enrol-link` (bootstrap)   | set a new password         |
 * | STAFF_INVITE     | `POST /admin/users/invite`, `…/enrolment-link` | set a new password |
 * | ADMIN_RECOVERY   | `iam-cli recover-admin`            | set a new password         |
 * | MFA_REENROLMENT  | `POST /admin/users/{id}/mfa-reset` | prove the CURRENT password |
 *
 * then `mfa/setup` (an unconfirmed TOTP factor) and `mfa/confirm` (a live code), which in one
 * transaction confirms the factor, stores ten recovery codes, activates the account
 * (ACTIVE, e-mail verified, MFA enrolled, securityVersion + 1), activates INVITED memberships and
 * consumes the token. No session is opened: the user signs in normally afterwards.
 *
 * - The account stays PENDING until the last step, and the database refuses an ACTIVE staff user
 *   without password and MFA (`User_staff_active_credentials_check`): no half activation.
 * - The re-enrolment needs the target's current password, so the administrator who reset the
 *   MFA (and saw the link) cannot take the account over (D9, NT-M6).
 * - Wrong current password or wrong code: the token counts a failure; the fifth invalidates it.
 * - A new-password step counts only if it happened under this token (`passwordUpdatedAt` at or
 *   after the token's creation), so a new link holder cannot ride on an earlier password.
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  type EnrolKind,
  EnrolMfaConfirmRequestSchema,
  EnrolPasswordRequestSchema,
  EnrolTokenRequestSchema,
  type EnrolInspectResponse,
  type EnrolMfaConfirmResponse,
  type EnrolMfaSetupResponse,
} from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import { maskEmail } from "../audit.js";
import { hashPassword, passwordPolicyProblems, verifyPassword } from "../auth/password.js";
import { decryptSecret, encryptSecret, mfaAad } from "../auth/secret-box.js";
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from "../auth/totp.js";
import { API_CONFIG, type ApiConfig } from "../http/api-config.js";
import { ApiError, parseBody } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import { AUTH_RETENTION } from "../auth/cleanup.js";
import { enrolActivateMemberships, enrolPasswordVerified } from "../iam-context.js";
import { writeAudit } from "./audit-writer.js";
import {
  ENROLMENT_PURPOSES,
  consumeToken,
  findLiveToken,
  recordTokenFailure,
  type LiveToken,
} from "./credentials.js";
import { replaceRecoveryCodes } from "./staff-auth.service.js";

const PASSWORD_VERIFIED = "iam.enrol_password_verified";

/** The link's purpose as the enrolment page names it (DP-114). */
const KIND: Readonly<Partial<Record<LiveToken["purpose"], EnrolKind>>> = {
  ADMIN_ENROLMENT: "activation",
  STAFF_INVITE: "invitation",
  ADMIN_RECOVERY: "recovery",
  MFA_REENROLMENT: "mfa_reenrolment",
};

@Injectable()
export class EnrolmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private async token(raw: string, now: Date): Promise<LiveToken> {
    const token = await findLiveToken(this.prisma, raw, ENROLMENT_PURPOSES, now);
    // Enrolment is for accounts that are not active yet (or again: MFA reset, recovery).
    if (!token || token.user.status !== "PENDING") throw new ApiError("AUTH_TOKEN_INVALID");
    return token;
  }

  private async passwordStepDone(token: LiveToken, raw: string): Promise<boolean> {
    if (token.purpose === "MFA_REENROLMENT") {
      // DP-125: the audit trail is under row-level security; the database answers for this live
      // link only, from the raw token (iam_enrol_password_verified).
      return enrolPasswordVerified(this.prisma, raw);
    }
    return (
      token.user.passwordHash !== null &&
      token.user.passwordUpdatedAt !== null &&
      token.user.passwordUpdatedAt.getTime() >= token.createdAt.getTime()
    );
  }

  private failAudit(ctx: RequestContext, token: LiveToken, reason: string) {
    return writeAudit(this.prisma, {
      actorType: "SYSTEM",
      action: "iam.enrol_failed",
      resourceType: "user",
      resourceId: token.user.id,
      scopeType: "PLATFORM",
      outcome: "DENIED",
      reason,
      metadata: { purpose: token.purpose },
      requestId: ctx.requestId,
    });
  }

  async inspect(body: unknown): Promise<EnrolInspectResponse> {
    const req = parseBody(EnrolTokenRequestSchema, body);
    const token = await this.token(req.token, this.clock.now());
    const passwordDone = await this.passwordStepDone(token, req.token);
    return {
      kind: KIND[token.purpose] ?? "activation",
      emailMasked: maskEmail(token.user.email),
      expiresAt: token.expiresAt.toISOString(),
      steps: [
        {
          step: token.purpose === "MFA_REENROLMENT" ? "current_password" : "password",
          done: passwordDone,
        },
        { step: "mfa", done: false },
      ],
    };
  }

  async password(ctx: RequestContext, body: unknown): Promise<void> {
    const req = parseBody(EnrolPasswordRequestSchema, body);
    const now = this.clock.now();
    const token = await this.token(req.token, now);
    const userId = token.user.id;

    if (token.purpose === "MFA_REENROLMENT") {
      if (!("currentPassword" in req)) {
        throw new ApiError("VALIDATION_FAILED", [{ path: "currentPassword", rule: "required" }]);
      }
      const ok =
        token.user.passwordHash !== null &&
        (await verifyPassword(token.user.passwordHash, req.currentPassword)).ok;
      if (!ok) {
        await recordTokenFailure(this.prisma, token.id, now);
        await this.failAudit(ctx, token, "wrong_current_password");
        throw new ApiError("AUTH_INVALID_CREDENTIALS");
      }
      await writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: userId,
        action: PASSWORD_VERIFIED,
        resourceType: "credential_token",
        resourceId: token.id,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        requestId: ctx.requestId,
      });
      return;
    }

    if (!("password" in req)) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "password", rule: "required" }]);
    }
    const problems = passwordPolicyProblems(req.password, {
      kind: "STAFF",
      hasMfa: true,
      email: token.user.email,
      displayName: token.user.displayName,
    });
    if (problems.length) throw new ApiError("AUTH_PASSWORD_POLICY", problems);
    const hash = await hashPassword(req.password);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, status: "PENDING", securityVersion: token.user.securityVersion },
        data: { passwordHash: hash, passwordUpdatedAt: now },
      });
      if (count !== 1) throw new ApiError("AUTH_TOKEN_INVALID");
      await writeAudit(tx, {
        actorType: "USER",
        actorUserId: userId,
        action: "iam.enrol_password_set",
        resourceType: "user",
        resourceId: userId,
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
        metadata: { purpose: token.purpose },
        requestId: ctx.requestId,
      });
    });
  }

  async mfaSetup(body: unknown): Promise<EnrolMfaSetupResponse> {
    const req = parseBody(EnrolTokenRequestSchema, body);
    const now = this.clock.now();
    const token = await this.token(req.token, now);
    if (!(await this.passwordStepDone(token, req.token))) throw new ApiError("CONFLICT_STATE");
    const userId = token.user.id;
    const secret = generateTotpSecret();
    const factorId = randomUUID();
    const ciphertext = encryptSecret(
      this.config.secrets.mfaKeyring,
      secret,
      mfaAad(userId, factorId),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaFactor.deleteMany({ where: { userId, confirmedAt: null } });
      await tx.mfaFactor.create({
        data: {
          id: factorId,
          userId,
          type: "TOTP",
          secretCiphertext: ciphertext,
          label: "Authenticator app",
          createdAt: now,
        },
      });
    });
    const response = {
      otpauthUri: otpauthUri(secret, token.user.email),
      secret: base32Encode(secret),
    };
    secret.fill(0);
    return response;
  }

  async mfaConfirm(ctx: RequestContext, body: unknown): Promise<EnrolMfaConfirmResponse> {
    const req = parseBody(EnrolMfaConfirmRequestSchema, body);
    const now = this.clock.now();
    const token = await this.token(req.token, now);
    const userId = token.user.id;
    if (!(await this.passwordStepDone(token, req.token))) throw new ApiError("CONFLICT_STATE");
    const oldest = new Date(now.getTime() - AUTH_RETENTION.unconfirmedFactorMinutes * 60_000);
    const factor = await this.prisma.mfaFactor.findFirst({
      where: {
        userId,
        type: "TOTP",
        confirmedAt: null,
        createdAt: { gte: new Date(Math.max(oldest.getTime(), token.createdAt.getTime())) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, secretCiphertext: true },
    });
    if (!factor) throw new ApiError("CONFLICT_STATE");
    let step: bigint | null = null;
    try {
      const secret = decryptSecret(
        this.config.secrets.mfaKeyring,
        factor.secretCiphertext,
        mfaAad(userId, factor.id),
      );
      step = verifyTotp(secret, req.code, now);
      secret.fill(0);
    } catch {
      step = null;
    }
    if (step === null) {
      await recordTokenFailure(this.prisma, token.id, now);
      await this.failAudit(ctx, token, "wrong_code");
      throw new ApiError("AUTH_MFA_INVALID");
    }

    const codes = await this.prisma.$transaction(async (tx) => {
      if (!(await consumeToken(tx, token.id, now))) throw new ApiError("AUTH_TOKEN_INVALID");
      await tx.mfaFactor.deleteMany({ where: { userId, id: { not: factor.id } } });
      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { confirmedAt: now, lastUsedStep: step, lastUsedAt: now },
      });
      const recoveryCodes = await replaceRecoveryCodes(
        tx,
        this.config.secrets.hmacKey,
        userId,
        now,
      );
      const { count } = await tx.user.updateMany({
        where: { id: userId, status: "PENDING", securityVersion: token.user.securityVersion },
        data: {
          status: "ACTIVE",
          mfaEnrolledAt: now,
          emailVerifiedAt: token.user.emailVerifiedAt ?? now,
          securityVersion: { increment: 1 },
        },
      });
      if (count !== 1) throw new ApiError("AUTH_TOKEN_INVALID");
      // DP-125: the user has no session yet; the database activates the INVITED memberships
      // itself once this transaction consumed the link (iam_enrol_activate_memberships).
      const membershipsActivated = await enrolActivateMemberships(tx, req.token);
      for (const action of ["iam.enrol_mfa_confirmed", "iam.user_activated"]) {
        await writeAudit(tx, {
          actorType: "USER",
          actorUserId: userId,
          action,
          resourceType: "user",
          resourceId: userId,
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
          metadata: { purpose: token.purpose, membershipsActivated },
          requestId: ctx.requestId,
        });
      }
      return recoveryCodes;
    });
    return { recoveryCodes: codes };
  }
}
