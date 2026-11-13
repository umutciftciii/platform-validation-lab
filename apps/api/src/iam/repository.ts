/**
 * Loads an authorization snapshot from PostgreSQL. The decision itself is pure (authorization.ts).
 * Role permissions come from the code catalogue; the database only says who holds which role
 * where, and which optional modules are on.
 */
import type { AuthorizationSnapshot, Grant } from "./authorization.js";
import { PLATFORM_SUPER_ADMIN, SYSTEM_OWNER } from "./catalog.js";
import type { Db } from "./db.js";
import type { ActTarget } from "./escalation.js";

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
 */
export async function countOtherPlatformAdmins(
  db: Db,
  excludeUserId: string,
  now: Date = new Date(),
  options: { nonExpiringOnly?: boolean } = {},
): Promise<number> {
  const users = await db.roleAssignment.findMany({
    where: {
      role: { key: PLATFORM_SUPER_ADMIN },
      scopeType: "PLATFORM",
      revokedAt: null,
      OR: options.nonExpiringOnly
        ? [{ expiresAt: null }]
        : [{ expiresAt: null }, { expiresAt: { gt: now } }],
      userId: { not: excludeUserId },
      user: { status: { in: ["ACTIVE", "PENDING"] } },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return users.length;
}

/**
 * Everyone who granted the user's active roles, directly or through a chain of active grants
 * (bounded breadth-first walk). Bootstrap grants have no grantor. Used by `canAssignRole` to
 * refuse reciprocal and indirect self-grants (F1-001B).
 */
export async function loadGrantAncestry(
  db: Db,
  userId: string,
  now: Date = new Date(),
  maxDepth = 32,
): Promise<Set<string>> {
  const ancestry = new Set<string>();
  let frontier = [userId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const rows = await db.roleAssignment.findMany({
      where: {
        userId: { in: frontier },
        grantedById: { not: null },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { grantedById: true },
    });
    frontier = [];
    for (const { grantedById } of rows) {
      if (grantedById && !ancestry.has(grantedById)) {
        ancestry.add(grantedById);
        frontier.push(grantedById);
      }
    }
  }
  return ancestry;
}

/**
 * Platform administrators that keep the platform administrable on their own (F1-002, design
 * 10.5): ACTIVE, MFA-enrolled, with a platform_super_admin assignment that is neither revoked
 * nor expiring. For a removal, exclude only the target: the acting administrator counts toward
 * what remains (`canActOnUser`, remainingQualifiedPlatformAdmins).
 */
export async function countQualifiedPlatformAdmins(
  db: Db,
  excludeUserIds: readonly string[],
): Promise<number> {
  const users = await db.roleAssignment.findMany({
    where: {
      role: { key: PLATFORM_SUPER_ADMIN },
      scopeType: "PLATFORM",
      revokedAt: null,
      expiresAt: null,
      userId: { notIn: [...excludeUserIds] },
      user: { status: "ACTIVE", kind: "STAFF", mfaEnrolledAt: { not: null } },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return users.length;
}

/** Loads a user as the target of an administration action (`canActOnUser`). */
export async function loadActTarget(db: Db, userId: string): Promise<ActTarget | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      kind: true,
      status: true,
      memberships: { where: { status: { not: "REVOKED" } }, select: { siteId: true } },
      roleAssignments: {
        where: { revokedAt: null },
        select: {
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
  return {
    userId: user.id,
    kind: user.kind,
    status: user.status,
    isSystemOwner: (await loadSystemOwnerId(db)) === user.id,
    grants: user.roleAssignments.map((a) => ({
      roleKey: a.role.key,
      scopeType: a.scopeType,
      siteId: a.siteId,
      expiresAt: a.expiresAt,
      revokedAt: a.revokedAt,
    })),
    membershipSiteIds: new Set(user.memberships.map((m) => m.siteId)),
  };
}
