/**
 * RBAC decision service (F1-001, DP-069). Pure functions over an authorization snapshot, so every
 * rule is unit-tested without a database; `loadAuthorizationSnapshot` (repository.ts) builds the
 * snapshot from PostgreSQL.
 *
 * Deny by default: a request is allowed only if an active grant of an active principal carries
 * the permission for exactly the requested target, the module is enabled for that site, and a
 * sensitive permission was MFA-verified in this session. There is no bypass flag: the platform
 * super admin and God Mode go through the same function. DP-108 (ADR-018): the system owner's God
 * Mode is an ordinary PLATFORM grant of the non-assignable `system_owner` role that the snapshot
 * loader adds from the SystemOwner record; `decide` still checks status, audience, module switches
 * and the MFA step-up for it.
 */
import {
  MODULE_BY_KEY,
  PERMISSION_BY_KEY,
  ROLE_BY_KEY,
  type ScopeTypeValue,
  type UserKindValue,
  type UserStatusValue,
} from "./catalog.js";

export interface Principal {
  userId: string;
  kind: UserKindValue;
  status: UserStatusValue;
  /** The current session passed an MFA challenge recently enough for step-up (session policy). */
  mfaVerified: boolean;
}

export interface Grant {
  /** RoleAssignment id, when loaded from the database (audit references, ADR-017 D7). */
  assignmentId?: string;
  roleKey: string;
  scopeType: ScopeTypeValue;
  siteId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface AuthorizationSnapshot {
  principal: Principal;
  grants: readonly Grant[];
  /** Sites where the principal's membership is ACTIVE. Site grants count only there. */
  activeMembershipSiteIds: ReadonlySet<string>;
  /** Optional modules enabled per site (siteId -> module keys). Core modules are always on. */
  enabledOptionalModules: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Users who, directly or through a chain, granted the principal's active roles
   * (`loadGrantAncestry`). Needed only for role assignment: assigning a role to one of them is a
   * reciprocal or indirect self-grant (F1-001B). Unknown (undefined) means assignment is denied.
   */
  grantAncestry?: ReadonlySet<string>;
  /**
   * DP-108: the principal is the system owner (SystemOwner record). Only then does a grant of the
   * non-assignable `system_owner` role count; such a grant from anywhere else is ignored.
   */
  isSystemOwner?: boolean;
}

/** `platform` = platform-wide: platform permissions, or a site permission on every site. */
export type Target = { scope: "platform" } | { scope: "site"; siteId: string };

export type DenyReason =
  | "unknown_permission"
  | "principal_inactive"
  | "audience_mismatch"
  | "site_required"
  | "platform_permission"
  | "module_disabled"
  | "no_grant"
  | "mfa_required";

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function isGrantActive(grant: Grant, now: Date): boolean {
  if (grant.revokedAt && grant.revokedAt <= now) return false;
  if (grant.expiresAt && grant.expiresAt <= now) return false;
  return true;
}

/** Whether a module is on for a site. Unknown modules are off; core modules are always on. */
export function isModuleEnabled(
  moduleKey: string,
  siteId: string,
  enabledOptionalModules: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const mod = MODULE_BY_KEY.get(moduleKey);
  if (!mod) return false;
  if (mod.isCore) return true;
  return enabledOptionalModules.get(siteId)?.has(moduleKey) ?? false;
}

function grantCovers(snapshot: AuthorizationSnapshot, grant: Grant, target: Target): boolean {
  const role = ROLE_BY_KEY.get(grant.roleKey);
  // A grant must agree with its role definition; anything else is ignored (deny by default).
  if (!role || role.audience !== snapshot.principal.kind || role.scopeType !== grant.scopeType) {
    return false;
  }
  if (role.assignable === false && snapshot.isSystemOwner !== true) return false;
  if (grant.scopeType === "PLATFORM") return grant.siteId === null;
  if (target.scope !== "site" || grant.siteId !== target.siteId) return false;
  return snapshot.activeMembershipSiteIds.has(target.siteId);
}

export function decide(
  snapshot: AuthorizationSnapshot,
  permissionKey: string,
  target: Target,
  now: Date = new Date(),
): Decision {
  const permission = PERMISSION_BY_KEY.get(permissionKey);
  if (!permission) return deny("unknown_permission");
  const { principal } = snapshot;
  if (principal.status !== "ACTIVE") return deny("principal_inactive");
  if (permission.audience !== principal.kind) return deny("audience_mismatch");

  const mod = MODULE_BY_KEY.get(permission.module);
  if (permission.scopeType === "PLATFORM") {
    if (target.scope !== "platform") return deny("platform_permission");
  } else if (target.scope === "platform") {
    // Platform-wide use of a site permission is fine for core modules only: optional modules are
    // switched per site, so they need a site.
    if (!mod?.isCore) return deny("site_required");
  } else if (!isModuleEnabled(permission.module, target.siteId, snapshot.enabledOptionalModules)) {
    return deny("module_disabled");
  }

  const granted = snapshot.grants.some(
    (g) =>
      isGrantActive(g, now) &&
      grantCovers(snapshot, g, target) &&
      (ROLE_BY_KEY.get(g.roleKey)?.permissions.includes(permissionKey) ?? false),
  );
  if (!granted) return deny("no_grant");
  if (permission.sensitive && !principal.mfaVerified) return deny("mfa_required");
  return { allowed: true };
}

/**
 * Permissions the principal's active grants carry for a target. Used for the no-escalation rule,
 * so it ignores what only gates *use*: the MFA step-up (a property of the session) and module
 * switches (a site admin still holds the CRM permissions of its role while CRM is off, and may
 * hand that role out). A PLATFORM permission is held only for the platform target.
 */
export function heldPermissions(
  snapshot: AuthorizationSnapshot,
  target: Target,
  now: Date = new Date(),
): Set<string> {
  const held = new Set<string>();
  if (snapshot.principal.status !== "ACTIVE") return held;
  for (const g of snapshot.grants) {
    if (!isGrantActive(g, now) || !grantCovers(snapshot, g, target)) continue;
    for (const key of ROLE_BY_KEY.get(g.roleKey)?.permissions ?? []) {
      const p = PERMISSION_BY_KEY.get(key);
      if (!p || p.audience !== snapshot.principal.kind) continue;
      if (p.scopeType === "PLATFORM" && target.scope !== "platform") continue;
      held.add(key);
    }
  }
  return held;
}

/**
 * Sites on which a permission is allowed, for query scoping (site-scope.ts). `includePlatform`
 * says whether platform-level rows (siteId null, e.g. platform audit events) are visible too.
 */
export function accessibleScope(
  snapshot: AuthorizationSnapshot,
  permissionKey: string,
  allSiteIds: readonly string[],
  now: Date = new Date(),
): { siteIds: string[]; includePlatform: boolean } {
  const siteIds = allSiteIds.filter(
    (siteId) => decide(snapshot, permissionKey, { scope: "site", siteId }, now).allowed,
  );
  // Only a PLATFORM-scope grant can satisfy a platform target (grantCovers).
  const includePlatform = decide(snapshot, permissionKey, { scope: "platform" }, now).allowed;
  return { siteIds, includePlatform };
}
