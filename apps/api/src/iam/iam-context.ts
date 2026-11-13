/**
 * The way into the IAM site tables under row-level security (DP-125; ADR-012B part 2).
 *
 * "Membership", "RoleAssignment", "ModuleConfiguration", "AuditEvent" and
 * "CustomerDataAccessRequest" have row-level security for dp_app (migration
 * 20261125090000_dp_125_iam_row_level_security). Without a context of the current transaction
 * they show no row (fail closed). The context is the one of DP-103: the RAW admin session token,
 * set with `set_config(..., true)` (transaction-local) by `leads_rls_set_staff_context`; the
 * database finds the session's user and what that user may see by itself.
 *
 *  - `inStaffContext` opens one interactive transaction, sets the context and hands over the
 *    (unscoped, infrastructure) client of that transaction.
 *  - The other functions call the narrow SECURITY DEFINER functions of the migration for what a
 *    flow needs beyond the caller's own rows (counts, the caller's grant ancestry, the target of a
 *    user-administration action, the operator CLI, /enrol, lead assignees, the legacy sweep).
 *    They return ids, counts or booleans only. Session-bound ones must run inside
 *    `inStaffContext`; outside it they answer "unknown" (null) or nothing.
 *
 * Every value is a bind parameter (tagged templates only).
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Db } from "./db.js";

export interface StaffContextOptions {
  /** Interactive transaction timeout in ms (Prisma default 5000). */
  timeout?: number;
}

/** Sets the staff context in a running interactive transaction (first statement). */
export async function setStaffContext(tx: Db, sessionToken: string): Promise<void> {
  await tx.$executeRaw`SELECT leads_rls_set_staff_context(${sessionToken})`;
}

/** Runs `fn` in one transaction whose database context is this admin session. */
export function inStaffContext<T>(
  prisma: PrismaClient,
  sessionToken: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: StaffContextOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await setStaffContext(tx, sessionToken);
      return fn(tx);
    },
    options.timeout ? { timeout: options.timeout } : undefined,
  );
}

const count = (v: bigint | number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

/**
 * Platform administrators other than `excludeUserId` (session-bound; answered only to a
 * platform-wide IAM administrator, else undefined = unknown = deny).
 */
export async function platformAdminCount(
  tx: Db,
  excludeUserId: string | null,
  nonExpiringOnly = false,
): Promise<number | undefined> {
  const rows = await tx.$queryRaw<{ n: bigint | null }[]>`
    SELECT iam_rls_platform_admin_count(${excludeUserId}::uuid, ${nonExpiringOnly}) AS n`;
  return count(rows[0]?.n);
}

/** Qualified platform administrators outside `excludeUserIds` (session-bound, as above). */
export async function qualifiedAdminCount(
  tx: Db,
  excludeUserIds: readonly string[],
): Promise<number | undefined> {
  const rows = await tx.$queryRaw<{ n: bigint | null }[]>`
    SELECT iam_rls_qualified_admin_count(${[...excludeUserIds]}::uuid[]) AS n`;
  return count(rows[0]?.n);
}

/** The session user's grant ancestry (F1-001B). */
export async function myGrantAncestry(tx: Db): Promise<Set<string>> {
  const rows = await tx.$queryRaw<{ ids: string[] | null }[]>`
    SELECT iam_rls_my_grant_ancestry()::text[] AS ids`;
  return new Set(rows[0]?.ids ?? []);
}

export interface AdminTargetRow {
  row_kind: "grant" | "membership";
  role_key: string | null;
  scope_type: "PLATFORM" | "SITE";
  site_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** Open grants and non-REVOKED memberships of an administration target (session-bound). */
export function adminTargetRows(tx: Db, targetId: string): Promise<AdminTargetRow[]> {
  return tx.$queryRaw<AdminTargetRow[]>`
    SELECT row_kind, role_key, scope_type::text AS scope_type, site_id::text AS site_id,
           expires_at, revoked_at
    FROM iam_rls_admin_target(${targetId}::uuid)`;
}

/** Rows of a user still open after a bulk change (platform-wide IAM writers only). */
export async function userOpenRows(
  tx: Db,
  targetId: string,
): Promise<{ roles: number | undefined; memberships: number | undefined }> {
  const rows = await tx.$queryRaw<{ open_roles: bigint | null; open_memberships: bigint | null }[]>`
    SELECT open_roles, open_memberships FROM iam_rls_user_open_rows(${targetId}::uuid)`;
  return { roles: count(rows[0]?.open_roles), memberships: count(rows[0]?.open_memberships) };
}

/** Operator CLI (no session): the platform-administrator state of one staff account. */
export async function operatorAdminState(
  db: Db,
  targetId: string,
): Promise<{ bootstrapGrant: boolean; activeAdmin: boolean; otherQualifiedAdmins: number }> {
  const rows = await db.$queryRaw<
    { bootstrap_grant: boolean; active_admin: boolean; other_qualified_admins: bigint }[]
  >`SELECT bootstrap_grant, active_admin, other_qualified_admins
    FROM iam_operator_admin_state(${targetId}::uuid)`;
  const r = rows[0];
  return {
    bootstrapGrant: r?.bootstrap_grant ?? false,
    activeAdmin: r?.active_admin ?? false,
    // Unknown counts as "another administrator exists": recover-admin refuses (deny by default).
    otherQualifiedAdmins: r ? Number(r.other_qualified_admins) : Number.MAX_SAFE_INTEGER,
  };
}

/** /enrol (MFA re-enrolment): whether this live link's password step was verified. */
export async function enrolPasswordVerified(db: Db, rawToken: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT iam_enrol_password_verified(${rawToken}) AS ok`;
  return rows[0]?.ok === true;
}

/** /enrol completion: activates the INVITED memberships (link consumed in this transaction). */
export async function enrolActivateMemberships(tx: Db, rawToken: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT iam_enrol_activate_memberships(${rawToken}) AS n`;
  return Number(rows[0]?.n ?? 0);
}

/** DP-041: (site, user) pairs of staff with lead:manage, for sites the session reads leads of. */
export function assignableStaff(
  tx: Db,
  siteIds: readonly string[],
): Promise<{ site_id: string; user_id: string }[]> {
  return tx.$queryRaw<{ site_id: string; user_id: string }[]>`
    SELECT site_id::text AS site_id, user_id::text AS user_id
    FROM leads_rls_assignable_staff(${[...siteIds]}::uuid[])`;
}

/** DP-077 legacy sweep (K3), counts only. */
export async function customerDataSweep(
  db: Db,
  at: Date,
): Promise<{ requestsExpired: number; accessExpired: number }> {
  const rows = await db.$queryRaw<{ requests_expired: number; access_expired: number }[]>`
    SELECT requests_expired, access_expired FROM iam_customer_data_sweep(${at}::timestamptz)`;
  return {
    requestsExpired: Number(rows[0]?.requests_expired ?? 0),
    accessExpired: Number(rows[0]?.access_expired ?? 0),
  };
}
