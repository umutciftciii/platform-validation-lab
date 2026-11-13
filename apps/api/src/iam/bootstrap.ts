/**
 * Secure bootstrap of the first platform administrator (F1-001, ADR-011 section 6).
 *
 * - Runs once: it refuses when an active platform_super_admin assignment exists.
 * - No password, default or generated: the account is created PENDING with no credential. It can
 *   do nothing until DP-011's enrolment sets a password (Argon2id) and MFA and activates it;
 *   `decide` denies every request of a non-ACTIVE principal.
 * - Serialised by a transaction-scoped advisory lock and SERIALIZABLE isolation, so two
 *   concurrent runs cannot both create an administrator.
 * - Audited: success and refusal are written to AuditEvent with actor BOOTSTRAP.
 * - Operator-only: run from a shell with access to the environment (`iam-cli.js bootstrap`); the
 *   API exposes no bootstrap endpoint.
 * - ADR-012A: it connects as dp_iam_bootstrap, which may read the catalogue but not write it, so
 *   it no longer syncs the catalogue itself. It refuses unless `iam:sync` (dp_owner) has made the
 *   catalogue tables match the code, because the guard triggers decide with those rows.
 */
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { buildAuditEvent } from "./audit.js";
import { PLATFORM_SUPER_ADMIN } from "./catalog.js";
import { catalogProblems } from "./catalog-sync.js";
import type { Db } from "./db.js";

/** The database identity of a connection (ADR-012A): `current_user` and `session_user`. */
export interface DatabaseIdentity {
  currentUser: string;
  sessionUser: string;
}

export async function databaseIdentity(db: Db): Promise<DatabaseIdentity> {
  const rows = await db.$queryRaw<{ cu: string; su: string }[]>`
    SELECT current_user::text AS cu, session_user::text AS su`;
  const row = rows[0];
  if (!row) throw new Error("could not read the database identity");
  return { currentUser: row.cu, sessionUser: row.su };
}

/** pg_advisory_xact_lock key for the bootstrap ("IAMBOOT" in ASCII, fits in bigint). */
export const BOOTSTRAP_LOCK_KEY = 0x49414d424f4f54n;

export class BootstrapRefusedError extends Error {
  override name = "BootstrapRefusedError";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BootstrapResult {
  userId: string;
  roleAssignmentId: string;
  createdUser: boolean;
}

export async function bootstrapPlatformAdmin(
  prisma: PrismaClient,
  input: { email: string; displayName?: string },
  now: Date = new Date(),
): Promise<BootstrapResult> {
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  if (!EMAIL.test(emailNormalized) || emailNormalized.length > 320) {
    throw new BootstrapRefusedError("bootstrap needs a valid e-mail address");
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        // pg_advisory_xact_lock returns void, which Prisma cannot deserialize; select a constant.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;
        const drift = await catalogProblems(tx);
        if (drift.length > 0) {
          throw new BootstrapRefusedError(
            `the IAM catalogue in the database does not match the code (${drift.length} difference(s), first: ${drift[0]}); run iam:sync first`,
          );
        }
        const active = await tx.roleAssignment.count({
          where: {
            role: { key: PLATFORM_SUPER_ADMIN },
            scopeType: "PLATFORM",
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        });
        if (active > 0) {
          throw new BootstrapRefusedError(
            "a platform administrator already exists; bootstrap runs only once",
          );
        }
        let user = await tx.user.findUnique({ where: { emailNormalized } });
        const createdUser = !user;
        if (user && user.kind !== "STAFF") {
          throw new BootstrapRefusedError("this e-mail belongs to a customer account");
        }
        user ??= await tx.user.create({
          data: {
            email,
            emailNormalized,
            kind: "STAFF",
            status: "PENDING",
            displayName: input.displayName?.trim() || null,
          },
        });
        const role = await tx.role.findUniqueOrThrow({ where: { key: PLATFORM_SUPER_ADMIN } });
        const assignment = await tx.roleAssignment.create({
          data: {
            userId: user.id,
            roleId: role.id,
            scopeType: "PLATFORM",
            siteId: null,
            grantedById: null,
            reason: "bootstrap: first platform administrator",
          },
        });
        // createMany: a plain INSERT without RETURNING, so the bootstrap role needs no SELECT on
        // the audit trail (ADR-012A least privilege).
        await tx.auditEvent.createMany({
          data: [
            toAuditData({
              actorType: "BOOTSTRAP",
              action: "iam.bootstrap_admin",
              resourceType: "role_assignment",
              resourceId: assignment.id,
              scopeType: "PLATFORM",
              outcome: "SUCCESS",
              metadata: { userId: user.id, email, role: PLATFORM_SUPER_ADMIN, createdUser },
            }),
          ],
        });
        return { userId: user.id, roleAssignmentId: assignment.id, createdUser };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof BootstrapRefusedError) {
      await prisma.auditEvent.createMany({
        data: [
          toAuditData({
            actorType: "BOOTSTRAP",
            action: "iam.bootstrap_admin",
            resourceType: "role_assignment",
            scopeType: "PLATFORM",
            outcome: "DENIED",
            reason: error.message,
            metadata: { email },
          }),
        ],
      });
    }
    throw error;
  }
}

function toAuditData(input: Parameters<typeof buildAuditEvent>[0]) {
  const event = buildAuditEvent(input);
  return { ...event, metadata: event.metadata as Prisma.InputJsonObject };
}
