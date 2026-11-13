/**
 * Loads an authorization snapshot from PostgreSQL. The decision itself is pure (authorization.ts).
 * Role permissions come from the code catalogue; the database only says who holds which role
 * where, and which optional modules are on.
 *
 * DP-125 (ADR-012B part 2): "Membership", "RoleAssignment" and "ModuleConfiguration" have
 * row-level security. Call these functions with the client of an `inStaffContext` transaction
 * (iam-context.ts) of the user's own session: the database then shows the user's own assignments
 * and memberships and the module states of the sites the user reaches. Without that context the
 * snapshot has no grant (deny by default).
 */
import type { AuthorizationSnapshot, Grant } from "./authorization.js";
import { SYSTEM_OWNER } from "./catalog.js";
import type { Db } from "./db.js";
import type { ActTarget } from "./escalation.js";
import {
  adminTargetRows,
  myGrantAncestry,
  platformAdminCount,
  qualifiedAdminCount,
} from "./iam-context.js";

export async function loadAuthorizationSnapshot(
  db: Db,
  userId: string,
  session: { mfaVerified: boolean },
): Promise<AuthorizationSnapshot | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      kind: true,
      status: true,
      memberships: { where: { status: "ACTIVE" }, select: { siteId: true } },
      roleAssignments: {
        where: { revokedAt: null },
        select: {
          id: true,
          scopeType: true,
          siteId: true,
          expiresAt: true,
          revokedAt: true,
          role: { select: { key: true } },
        },
      },
    },
  });
  if (!user) return null;
  const isSystemOwner = (await loadSystemOwnerId(db)) === user.id;

  const enabled = await db.moduleConfiguration.findMany({
    where: { enabled: true, module: { isCore: false } },
    select: { siteId: true, module: { select: { key: true } } },
  });
  const enabledOptionalModules = new Map<string, Set<string>>();
  for (const row of enabled) {
    const set = enabledOptionalModules.get(row.siteId) ?? new Set<string>();
    set.add(row.module.key);
    enabledOptionalModules.set(row.siteId, set);
  }

  return {
    principal: {
      userId: user.id,
      kind: user.kind,
      status: user.status,
      mfaVerified: session.mfaVerified,
    },
    grants: [
      // A stored system_owner assignment is refused by the database; ignore one anyway.
      ...user.roleAssignments
        .filter((a) => a.role.key !== SYSTEM_OWNER)
        .map((a) => ({
          assignmentId: a.id,
          roleKey: a.role.key,
          scopeType: a.scopeType,
          siteId: a.siteId,
          expiresAt: a.expiresAt,
          revokedAt: a.revokedAt,
        })),
      ...(isSystemOwner ? [SYSTEM_OWNER_GRANT] : []),
    ],
    activeMembershipSiteIds: new Set(user.memberships.map((m) => m.siteId)),
    enabledOptionalModules,
    isSystemOwner,
  };
}

/** DP-108: God Mode as a grant. It has no assignment id: no RoleAssignment row stands behind it. */
export const SYSTEM_OWNER_GRANT: Grant = Object.freeze({
  roleKey: SYSTEM_OWNER,
  scopeType: "PLATFORM",
  siteId: null,
  expiresAt: null,
  revokedAt: null,
});

/** DP-108: the user id of the system owner, or null before the designation. */
export async function loadSystemOwnerId(db: Db): Promise<string | null> {
  const row = await db.systemOwner.findFirst({ select: { userId: true } });
  return row?.userId ?? null;
}

/**
 * Users other than `excludeUserId` who can still administer the platform: ACTIVE or PENDING
 * (bootstrap, not yet enrolled) with an active platform_super_admin assignment. Input for
 * `canRevokeRole` / `platformAdminRemovalProblem`.
 *
 * DP-125: counted by the database (iam_rls_platform_admin_count) inside the caller's staff
 * context, because row-level security shows the caller only some assignments. Answered only to a
 * platform-wide IAM administrator; otherwise 0 (unknown counts as zero: deny by default).
 */
export async function countOtherPlatformAdmins(
  db: Db,
  excludeUserId: string,
  options: { nonExpiringOnly?: boolean } = {},
): Promise<number> {
  return (await platformAdminCount(db, excludeUserId, options.nonExpiringOnly ?? false)) ?? 0;
}

/**
 * Everyone who granted the session user's active roles, directly or through a chain of active
 * grants (F1-001B; `canAssignRole` / `canActOnUser` refuse reciprocal and indirect self-grants).
 *
 * DP-125: walked by the database (iam_rls_my_grant_ancestry) inside the staff context of
 * `userId`'s own session: under row-level security a walk in the API would miss the grants of
 * other sites and so miss ancestors. An ancestry is only ever loaded for the caller itself.
 */
export async function loadGrantAncestry(db: Db): Promise<Set<string>> {
  return myGrantAncestry(db);
}

/**
 * Platform administrators that keep the platform administrable on their own (F1-002, design
 * 10.5): ACTIVE, MFA-enrolled, with a platform_super_admin assignment that is neither revoked
 * nor expiring. For a removal, exclude only the target: the acting administrator counts toward
 * what remains (`canActOnUser`, remainingQualifiedPlatformAdmins).
 *
 * DP-125: counted by the database inside the caller's staff context (platform-wide IAM
 * administrators only); undefined when unknown (deny by default in `canActOnUser`).
 */
export async function countQualifiedPlatformAdmins(
  db: Db,
  excludeUserIds: readonly string[],
): Promise<number | undefined> {
  return qualifiedAdminCount(db, excludeUserIds);
}

/**
 * Loads a user as the target of an administration action (`canActOnUser`).
 *
 * DP-125: the target's grants and memberships come from iam_rls_admin_target inside the caller's
 * staff context. The superiority rule must see the target's roles on every site, which row-level
 * security would hide; the database answers only when the target works on a site where the caller
 * administers staff (else no row: the target is out of scope, 404).
 */
export async function loadActTarget(db: Db, userId: string): Promise<ActTarget | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, kind: true, status: true },
  });
  if (!user) return null;
  const rows = await adminTargetRows(db, user.id);
  return {
    userId: user.id,
    kind: user.kind,
    status: user.status,
    isSystemOwner: (await loadSystemOwnerId(db)) === user.id,
    grants: rows
      .filter((r) => r.row_kind === "grant" && r.role_key !== null)
      .map((r) => ({
        roleKey: r.role_key as string,
        scopeType: r.scope_type,
        siteId: r.site_id,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
      })),
    membershipSiteIds: new Set(
      rows.filter((r) => r.row_kind === "membership" && r.site_id).map((r) => r.site_id as string),
    ),
  };
}
