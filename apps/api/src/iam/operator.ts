/**
 * Operator recovery and link commands (F1-002 Group 2; ADR-013 D9, D18; design 4.4, 6, 11.5).
 * Run only through `iam-cli` from a shell with access to the environment; there is no HTTP
 * route to any of them. Each connects as dp_app (the API's least-privileged role): none needs
 * more, and the bootstrap credential stays reserved for the one-time bootstrap.
 *
 * - `enrolLink`: the activation link of the bootstrap administrator (ADMIN_ENROLMENT, 30 min).
 * - `resetLink`: a staff password-reset link (PASSWORD_RESET, 30 min); the reset still needs the
 *   user's TOTP or a recovery code, so the operator cannot take the account over.
 * - `recoverAdmin`: last resort when the only qualified platform administrator lost password and
 *   MFA. Refused while another ACTIVE, MFA-enrolled, non-expiring administrator exists (that one
 *   uses mfa-reset). Clears password and MFA, ends every session, and issues ADMIN_RECOVERY.
 *
 * Links are returned to the CLI, printed once and never logged; audit actor BOOTSTRAP.
 *
 * DP-108 (ADR-018): none of these works on the system owner's account (the database refuses it as
 * well); the owner is recovered only with `iam-cli owner-recover` (dp_iam_bootstrap).
 */
import type { PrismaClient } from "../generated/prisma/client.js";
import { PLATFORM_SUPER_ADMIN } from "./catalog.js";
import { countQualifiedPlatformAdmins, loadSystemOwnerId } from "./repository.js";
import { normalizeEmail } from "./bootstrap.js";
import { writeAudit } from "./staff/audit-writer.js";
import {
  enrolmentLink,
  invalidateUserTokens,
  issueCredentialToken,
  resetLink,
} from "./staff/credentials.js";

export class OperatorRefusedError extends Error {
  override name = "OperatorRefusedError";
}

async function staffByEmail(prisma: PrismaClient, email: string) {
  const user = await prisma.user.findUnique({
    where: { emailNormalized: normalizeEmail(email) },
    select: {
      id: true,
      kind: true,
      status: true,
      securityVersion: true,
      emailVerifiedAt: true,
      mfaEnrolledAt: true,
      roleAssignments: {
        where: { revokedAt: null, role: { key: PLATFORM_SUPER_ADMIN }, scopeType: "PLATFORM" },
        select: { grantedById: true, expiresAt: true },
      },
    },
  });
  if (!user || user.kind !== "STAFF")
    throw new OperatorRefusedError("no staff account with this e-mail");
  return user;
}

/** DP-108: the operator commands of this file never touch the system owner. */
async function refuseOwner(prisma: PrismaClient, action: string, userId: string): Promise<void> {
  if ((await loadSystemOwnerId(prisma)) === userId) {
    await refuse(
      prisma,
      action,
      userId,
      "this is the system owner account; use iam-cli owner-recover (operator credential)",
    );
  }
}

async function refuse(
  prisma: PrismaClient,
  action: string,
  userId: string | null,
  reason: string,
): Promise<never> {
  await writeAudit(prisma, {
    actorType: "BOOTSTRAP",
    action,
    resourceType: "user",
    resourceId: userId,
    scopeType: "PLATFORM",
    outcome: "DENIED",
    reason,
  });
  throw new OperatorRefusedError(reason);
}

export async function operatorEnrolLink(
  prisma: PrismaClient,
  email: string,
  adminBaseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const user = await staffByEmail(prisma, email);
  await refuseOwner(prisma, "iam.enrol_link_issued", user.id);
  const bootstrapGrant = user.roleAssignments.some((a) => a.grantedById === null);
  if (!bootstrapGrant) {
    return refuse(
      prisma,
      "iam.enrol_link_issued",
      user.id,
      "only the bootstrap administrator is enrolled from the CLI; invite other staff",
    );
  }
  if (user.status !== "PENDING" || user.emailVerifiedAt !== null || user.mfaEnrolledAt !== null) {
    return refuse(
      prisma,
      "iam.enrol_link_issued",
      user.id,
      "the account is not waiting for its first activation",
    );
  }
  const token = await prisma.$transaction(async (tx) => {
    const issued = await issueCredentialToken(tx, {
      userId: user.id,
      purpose: "ADMIN_ENROLMENT",
      securityVersion: user.securityVersion,
      createdBy: { type: "BOOTSTRAP" },
      now,
    });
    await writeAudit(tx, {
      actorType: "BOOTSTRAP",
      action: "iam.enrol_link_issued",
      resourceType: "user",
      resourceId: user.id,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      metadata: { purpose: "ADMIN_ENROLMENT", expiresAt: issued.expiresAt },
    });
    return issued.token;
  });
  return enrolmentLink(adminBaseUrl, token);
}

export async function operatorResetLink(
  prisma: PrismaClient,
  email: string,
  adminBaseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const user = await staffByEmail(prisma, email);
  await refuseOwner(prisma, "iam.password_reset_issued", user.id);
  if (user.status !== "ACTIVE" || user.mfaEnrolledAt === null) {
    return refuse(
      prisma,
      "iam.password_reset_issued",
      user.id,
      "a reset link is only for ACTIVE staff with MFA",
    );
  }
  const token = await prisma.$transaction(async (tx) => {
    const issued = await issueCredentialToken(tx, {
      userId: user.id,
      purpose: "PASSWORD_RESET",
      securityVersion: user.securityVersion,
      createdBy: { type: "BOOTSTRAP" },
      now,
    });
    await writeAudit(tx, {
      actorType: "BOOTSTRAP",
      action: "iam.password_reset_issued",
      resourceType: "user",
      resourceId: user.id,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      metadata: { expiresAt: issued.expiresAt },
    });
    return issued.token;
  });
  return resetLink(adminBaseUrl, token);
}

export async function operatorRecoverAdmin(
  prisma: PrismaClient,
  email: string,
  reason: string,
  adminBaseUrl: string,
  now: Date = new Date(),
): Promise<string> {
  if (reason.trim().length < 10)
    throw new OperatorRefusedError("--reason needs at least 10 characters");
  const user = await staffByEmail(prisma, email);
  await refuseOwner(prisma, "iam.admin_recovery_issued", user.id);
  const admin = user.roleAssignments.some((a) => a.expiresAt === null || a.expiresAt > now);
  if (!admin || (user.status !== "ACTIVE" && user.status !== "PENDING")) {
    return refuse(
      prisma,
      "iam.admin_recovery_issued",
      user.id,
      "recover-admin is only for a platform administrator",
    );
  }
  const others = await countQualifiedPlatformAdmins(prisma, [user.id]);
  if (others > 0) {
    return refuse(
      prisma,
      "iam.admin_recovery_issued",
      user.id,
      "another qualified platform administrator exists; use mfa-reset instead",
    );
  }
  const token = await prisma.$transaction(async (tx) => {
    await tx.mfaFactor.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        status: "PENDING",
        passwordHash: null,
        mfaEnrolledAt: null,
        securityVersion: { increment: 1 },
      },
      select: { securityVersion: true },
    });
    const sessions = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: "SECURITY_VERSION" },
    });
    await invalidateUserTokens(tx, user.id, now);
    const issued = await issueCredentialToken(tx, {
      userId: user.id,
      purpose: "ADMIN_RECOVERY",
      securityVersion: updated.securityVersion,
      createdBy: { type: "BOOTSTRAP" },
      now,
    });
    await writeAudit(tx, {
      actorType: "BOOTSTRAP",
      action: "iam.admin_recovery_issued",
      resourceType: "user",
      resourceId: user.id,
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      reason: reason.trim(),
      metadata: { revokedCount: sessions.count, expiresAt: issued.expiresAt },
    });
    return issued.token;
  });
  return enrolmentLink(adminBaseUrl, token);
}
