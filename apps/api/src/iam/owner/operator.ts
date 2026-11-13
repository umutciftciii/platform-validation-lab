/**
 * Operator commands for the system owner (DP-108, ADR-018). They connect as dp_iam_bootstrap, the
 * operator credential that the API never holds (condition 1: the owner's recovery authority is not
 * in the application's database identity), and call SECURITY DEFINER functions that only that role
 * may execute:
 *
 * - `designateOwner`: starts a designation for an ACTIVE staff account with password and MFA.
 *   Prints a link (30 minutes, single use) that the person opens in the admin app and confirms
 *   with the current password and a fresh MFA step-up. Refused once an owner exists: the owner
 *   is never changed or handed on.
 * - `recoverOwner`: the owner lost password and MFA. Clears both, spends the recovery codes, ends
 *   every session and link and prints an ADMIN_RECOVERY link; ownership stays with the same user.
 * - `ownerStatus`: whether an owner is designated (masked e-mail and date only).
 *
 * The raw token exists only here and in the printed link (URL fragment); the database stores its
 * SHA-256. Refusals are audited as owner.* events, which the database files in the PROTECTED
 * stream.
 */
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { buildAuditEvent, maskEmail } from "../audit.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { normalizeEmail } from "../bootstrap.js";
import { enrolmentLink } from "../staff/credentials.js";

export class OwnerOperatorRefusedError extends Error {
  override name = "OwnerOperatorRefusedError";
}

/** The admin-app page that confirms a designation; the token travels in the fragment. */
export function ownerDesignationLink(adminBaseUrl: string, token: string): string {
  return `${adminBaseUrl}/owner/confirm#t=${token}`;
}

const DB_REFUSAL = /iam: ([^\n"]+)/;

function refusalMessage(error: unknown): string | null {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
  const m = DB_REFUSAL.exec(text);
  return m ? m[1]!.replace(/\s+\(DP-108\)$/, "").trim() : null;
}

async function staffIdByEmail(prisma: PrismaClient, email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { emailNormalized: normalizeEmail(email) },
    select: { id: true, kind: true },
  });
  if (!user || user.kind !== "STAFF") {
    throw new OwnerOperatorRefusedError("no staff account with this e-mail");
  }
  return user.id;
}

async function auditRefusal(
  prisma: PrismaClient,
  action: string,
  userId: string | null,
  reason: string,
): Promise<void> {
  const event = buildAuditEvent({
    actorType: "BOOTSTRAP",
    action,
    resourceType: "user",
    resourceId: userId,
    scopeType: "PLATFORM",
    outcome: "DENIED",
    reason,
  });
  // createMany: a plain INSERT without RETURNING (dp_iam_bootstrap may not read the audit trail).
  await prisma.auditEvent.createMany({
    data: [{ ...event, metadata: event.metadata as Prisma.InputJsonObject }],
  });
}

function checkReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 10)
    throw new OwnerOperatorRefusedError("--reason needs at least 10 characters");
  return trimmed;
}

async function run(
  prisma: PrismaClient,
  action: string,
  email: string,
  call: (userId: string, tokenHash: string) => Promise<Date>,
): Promise<{ token: string; expiresAt: Date }> {
  let userId: string | null = null;
  try {
    userId = await staffIdByEmail(prisma, email);
    const token = generateToken();
    const expiresAt = await call(userId, hashToken(token));
    return { token, expiresAt };
  } catch (error) {
    const reason =
      error instanceof OwnerOperatorRefusedError ? error.message : refusalMessage(error);
    if (reason === null) throw error;
    await auditRefusal(prisma, action, userId, reason);
    throw new OwnerOperatorRefusedError(reason);
  }
}

export async function designateOwner(
  prisma: PrismaClient,
  email: string,
  reason: string,
  adminBaseUrl: string,
): Promise<string> {
  const why = checkReason(reason);
  const { token } = await run(prisma, "owner.designation_started", email, async (id, hash) => {
    const rows = await prisma.$queryRaw<{ expires: Date }[]>`
      SELECT iam_owner_designation_start(${id}::uuid, ${hash}, ${why}) AS expires`;
    return rows[0]!.expires;
  });
  return ownerDesignationLink(adminBaseUrl, token);
}

export async function recoverOwner(
  prisma: PrismaClient,
  email: string,
  reason: string,
  adminBaseUrl: string,
): Promise<string> {
  const why = checkReason(reason);
  const { token } = await run(prisma, "owner.recovery_issued", email, async (id, hash) => {
    const rows = await prisma.$queryRaw<{ expires: Date }[]>`
      SELECT iam_owner_recover(${id}::uuid, ${hash}, ${why}) AS expires`;
    return rows[0]!.expires;
  });
  return enrolmentLink(adminBaseUrl, token);
}

export async function ownerStatus(prisma: PrismaClient): Promise<string> {
  const owner = await prisma.systemOwner.findFirst({
    select: { designatedAt: true, user: { select: { email: true, status: true } } },
  });
  if (!owner) return "no system owner is designated (iam-cli owner-designate)";
  return `system owner: ${maskEmail(owner.user.email)} (status ${owner.user.status}), designated ${owner.designatedAt.toISOString()}`;
}
