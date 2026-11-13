/**
 * Single-use credential tokens of staff authentication (F1-002 Group 2; design 6, 8.2; T15).
 * Shared by the HTTP endpoints and the operator CLI.
 *
 * - 256-bit random value, only its SHA-256 stored; the raw value is returned once (a link with
 *   the token in the URL fragment, so it never reaches a server log or a Referer).
 * - Bound to the user's `securityVersion` at issue time: a password reset, MFA reset, suspension
 *   or deactivation makes every older token useless.
 * - One live token per (user, purpose): issuing a new one invalidates the old one (NT-K3; the
 *   partial unique index enforces it).
 * - Five failed uses (wrong code, wrong current password) invalidate the token (NT-K2).
 * - Every token is checked for purpose, app, expiry, consumption, invalidation and security
 *   version; all failures look the same to the client (AUTH_TOKEN_INVALID, NT-K1).
 */
import type { CredentialTokenPurpose } from "../../generated/prisma/client.js";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import type { Db } from "../db.js";

export const TOKEN_TTL_MINUTES: Readonly<Record<StaffTokenPurpose, number>> = {
  ADMIN_ENROLMENT: 30,
  ADMIN_RECOVERY: 30,
  STAFF_INVITE: 24 * 60,
  MFA_REENROLMENT: 24 * 60,
  PASSWORD_RESET: 30,
  LOGIN_MFA_CHALLENGE: 5,
};

export type StaffTokenPurpose = Extract<
  CredentialTokenPurpose,
  | "ADMIN_ENROLMENT"
  | "ADMIN_RECOVERY"
  | "STAFF_INVITE"
  | "MFA_REENROLMENT"
  | "PASSWORD_RESET"
  | "LOGIN_MFA_CHALLENGE"
>;

/** Purposes handled by the enrolment endpoints (`/auth/staff/enrol/*`). */
export const ENROLMENT_PURPOSES: readonly StaffTokenPurpose[] = [
  "ADMIN_ENROLMENT",
  "STAFF_INVITE",
  "MFA_REENROLMENT",
  "ADMIN_RECOVERY",
];

export const MAX_TOKEN_FAILURES = 5;

export interface IssueTokenInput {
  userId: string;
  purpose: StaffTokenPurpose;
  securityVersion: number;
  createdBy: { type: "USER"; userId: string } | { type: "SYSTEM" | "BOOTSTRAP" };
  now: Date;
}

/** Invalidates the live token of the same purpose, then stores a new one. Returns the raw value. */
export async function issueCredentialToken(
  db: Db,
  input: IssueTokenInput,
): Promise<{ token: string; id: string; expiresAt: Date }> {
  await db.userCredentialToken.updateMany({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      consumedAt: null,
      invalidatedAt: null,
    },
    data: { invalidatedAt: input.now },
  });
  const token = generateToken();
  const expiresAt = new Date(input.now.getTime() + TOKEN_TTL_MINUTES[input.purpose] * 60_000);
  const row = await db.userCredentialToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(token),
      securityVersion: input.securityVersion,
      app: "ADMIN",
      expiresAt,
      createdAt: input.now,
      createdByType: input.createdBy.type,
      createdByUserId: input.createdBy.type === "USER" ? input.createdBy.userId : null,
    },
    select: { id: true },
  });
  return { token, id: row.id, expiresAt };
}

export interface LiveToken {
  id: string;
  purpose: StaffTokenPurpose;
  createdAt: Date;
  expiresAt: Date;
  failedAttempts: number;
  user: {
    id: string;
    email: string;
    emailNormalized: string;
    displayName: string | null;
    kind: "STAFF" | "CUSTOMER";
    status: "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
    passwordHash: string | null;
    passwordUpdatedAt: Date | null;
    emailVerifiedAt: Date | null;
    mfaEnrolledAt: Date | null;
    securityVersion: number;
  };
}

/** The token if it is live for one of `purposes` on the admin app; null otherwise. */
export async function findLiveToken(
  db: Db,
  raw: string | undefined,
  purposes: readonly StaffTokenPurpose[],
  now: Date,
): Promise<LiveToken | null> {
  if (!raw || !isWellFormedToken(raw)) return null;
  const row = await db.userCredentialToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: {
      id: true,
      purpose: true,
      app: true,
      createdAt: true,
      expiresAt: true,
      consumedAt: true,
      invalidatedAt: true,
      failedAttempts: true,
      securityVersion: true,
      user: {
        select: {
          id: true,
          email: true,
          emailNormalized: true,
          displayName: true,
          kind: true,
          status: true,
          passwordHash: true,
          passwordUpdatedAt: true,
          emailVerifiedAt: true,
          mfaEnrolledAt: true,
          securityVersion: true,
        },
      },
    },
  });
  if (
    !row ||
    !(purposes as readonly string[]).includes(row.purpose) ||
    row.app !== "ADMIN" ||
    row.consumedAt !== null ||
    row.invalidatedAt !== null ||
    row.expiresAt.getTime() <= now.getTime() ||
    row.securityVersion !== row.user.securityVersion ||
    row.user.kind !== "STAFF" ||
    row.user.status === "DEACTIVATED"
  ) {
    return null;
  }
  return {
    id: row.id,
    purpose: row.purpose as StaffTokenPurpose,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    failedAttempts: row.failedAttempts,
    user: row.user,
  };
}

/** Counts a failed use; the fifth failure invalidates the token. Safe under concurrency. */
export async function recordTokenFailure(db: Db, tokenId: string, now: Date): Promise<void> {
  await db.userCredentialToken.updateMany({
    where: {
      id: tokenId,
      failedAttempts: { lt: MAX_TOKEN_FAILURES },
      consumedAt: null,
      invalidatedAt: null,
    },
    data: { failedAttempts: { increment: 1 } },
  });
  await db.userCredentialToken.updateMany({
    where: {
      id: tokenId,
      failedAttempts: MAX_TOKEN_FAILURES,
      invalidatedAt: null,
      consumedAt: null,
    },
    data: { invalidatedAt: now },
  });
}

/** Consumes a live token; false if a parallel request consumed or invalidated it first. */
export async function consumeToken(db: Db, tokenId: string, now: Date): Promise<boolean> {
  const { count } = await db.userCredentialToken.updateMany({
    where: { id: tokenId, consumedAt: null, invalidatedAt: null },
    data: { consumedAt: now },
  });
  return count === 1;
}

/** Invalidates every live token of a user (deactivation, suspension, MFA reset). */
export async function invalidateUserTokens(db: Db, userId: string, now: Date): Promise<number> {
  const { count } = await db.userCredentialToken.updateMany({
    where: { userId, consumedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });
  return count;
}

/** Links carry the token in the fragment: it never reaches a server log or a Referer header. */
export function enrolmentLink(adminBaseUrl: string, token: string): string {
  return `${adminBaseUrl}/enrol#t=${token}`;
}

export function resetLink(adminBaseUrl: string, token: string): string {
  return `${adminBaseUrl}/reset#t=${token}`;
}
