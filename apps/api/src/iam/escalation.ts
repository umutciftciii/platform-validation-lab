/**
 * Privilege-escalation control for role assignments (F1-001, DP-069).
 *
 * A grantor may assign a role only if all of these hold:
 *  - the grantor is allowed `role_assignment:grant` for the target scope (this includes the MFA
 *    step-up, because the permission is sensitive); a PLATFORM-scope role needs a platform grant;
 *  - the assignee is not in the grantor's grant ancestry: nobody who (directly or through a chain)
 *    granted the grantor's roles can receive a role from the grantor. This blocks reciprocal
 *    grants (A→B, then B→A) and indirect self-grants (A→B→C→A) (F1-001B);
 *  - customer-data roles are assigned like any other role since the DP-076 revision (ADR-017 v2):
 *    no second approver, justification or expiry; the no-escalation rule below still applies, so
 *    only a grantor holding the lead/CRM permissions (super admin) can hand them out;
 *  - for a staff role: the grantor already holds every permission of the role at that scope (no
 *    escalation). Delegation: a permission with `delegableVia` may instead be handed out by a
 *    holder of that platform permission (the super admin manages publisher roles through
 *    `publisher_role:grant` without publishing itself). Customer permissions are never held by
 *    staff, so a customer role (member) instead needs `membership:manage` at that scope;
 *  - the grantor is not the assignee (no self-grant; also a CHECK constraint);
 *  - the role's audience matches the assignee's kind, and its scope type matches the requested
 *    scope (also enforced by the RoleAssignment trigger);
 *  - the assignee is not deactivated;
 *  - DP-108: the role is assignable (`system_owner` never is) and the assignee is not the system
 *    owner (nobody gives the owner a role; the database refuses both too).
 * Revocation is checked by `canRevokeRole`; removing the last active platform administrator is
 * refused there, in `platformAdminRemovalProblem`, and by database triggers.
 */
import {
  decide,
  heldPermissions,
  isGrantActive,
  type AuthorizationSnapshot,
  type Grant,
  type Target,
} from "./authorization.js";
import {
  PERMISSION_BY_KEY,
  PLATFORM_SUPER_ADMIN,
  RETIRED_PERMISSIONS,
  ROLE_BY_KEY,
  isAssignableRole,
  type RoleDef,
  type UserKindValue,
  type UserStatusValue,
} from "./catalog.js";

export interface Assignee {
  userId: string;
  kind: UserKindValue;
  status: UserStatusValue;
  /** DP-108: the assignee is the system owner. */
  isSystemOwner?: boolean;
}

export type EscalationDenyReason =
  | "unknown_role"
  | "self_grant"
  | "audience_mismatch"
  | "scope_mismatch"
  | "assignee_inactive"
  | "not_allowed"
  | "mfa_required"
  | "escalation"
  | "ancestry_unknown"
  | "reciprocal_grant"
  | "last_platform_admin"
  | "not_assignable"
  | "owner_target";

export type EscalationDecision =
  { allowed: true } | { allowed: false; reason: EscalationDenyReason; missing?: string[] };

export function canAssignRole(
  grantor: AuthorizationSnapshot,
  assignee: Assignee,
  roleKey: string,
  target: Target,
  now: Date = new Date(),
  /** Role definitions to look the assigned role up in; tests pass synthetic roles. */
  roles: ReadonlyMap<string, RoleDef> = ROLE_BY_KEY,
): EscalationDecision {
  const role = roles.get(roleKey);
  if (!role) return { allowed: false, reason: "unknown_role" };
  if (!isAssignableRole(role)) return { allowed: false, reason: "not_assignable" };
  if (grantor.principal.userId === assignee.userId) return { allowed: false, reason: "self_grant" };
  if (assignee.isSystemOwner) return { allowed: false, reason: "owner_target" };
  if (role.audience !== assignee.kind) return { allowed: false, reason: "audience_mismatch" };
  if ((role.scopeType === "PLATFORM") !== (target.scope === "platform")) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  if (assignee.status === "DEACTIVATED") return { allowed: false, reason: "assignee_inactive" };
  if (!grantor.grantAncestry) return { allowed: false, reason: "ancestry_unknown" };
  if (grantor.grantAncestry.has(assignee.userId)) {
    return { allowed: false, reason: "reciprocal_grant" };
  }

  const may = decide(grantor, "role_assignment:grant", target, now);
  if (!may.allowed) {
    return {
      allowed: false,
      reason: may.reason === "mfa_required" ? "mfa_required" : "not_allowed",
    };
  }
  if (role.audience === "CUSTOMER") {
    const manage = decide(grantor, "membership:manage", target, now);
    return manage.allowed ? { allowed: true } : { allowed: false, reason: "not_allowed" };
  }
  const held = heldPermissions(grantor, target, now);
  const missing = role.permissions.filter((key) => {
    // Retired permissions grant nothing, so nobody needs to hold them (DP-108: the owner does not).
    if (held.has(key) || RETIRED_PERMISSIONS.includes(key)) return false;
    // Holding the delegating permission is enough; the sign-in MFA covers it (DP-076 revision).
    const via = PERMISSION_BY_KEY.get(key)?.delegableVia;
    return !(via && heldPermissions(grantor, { scope: "platform" }, now).has(via));
  });
  if (missing.length) return { allowed: false, reason: "escalation", missing };
  return { allowed: true };
}

/**
 * Last-admin protection (F1-001A). `otherActivePlatformAdmins` counts users other than the one
 * affected who are ACTIVE or PENDING and hold an active platform_super_admin assignment
 * (`countOtherPlatformAdmins`). Removing, revoking, suspending or deactivating the last one is
 * refused; the database enforces the same rule with triggers (migration f1_001a).
 */
export function platformAdminRemovalProblem(
  affectsPlatformAdmin: boolean,
  otherActivePlatformAdmins: number | undefined,
): "last_platform_admin" | null {
  if (!affectsPlatformAdmin) return null;
  // Unknown counts are treated as zero: deny by default.
  return (otherActivePlatformAdmins ?? 0) > 0 ? null : "last_platform_admin";
}

/**
 * The last active platform administrator's assignment never gets an expiry (F1-001B): setting
 * `expiresAt` on a platform_super_admin assignment needs another active administrator whose
 * assignment does not expire (`countOtherPlatformAdmins(…, { nonExpiringOnly: true })`). The
 * database enforces the same rule.
 */
export function platformAdminExpiryProblem(
  isPlatformAdminAssignment: boolean,
  otherNonExpiringPlatformAdmins: number | undefined,
): "last_platform_admin" | null {
  if (!isPlatformAdminAssignment) return null;
  return (otherNonExpiringPlatformAdmins ?? 0) > 0 ? null : "last_platform_admin";
}

/**
 * Revoking needs `role_assignment:revoke` at the assignment's scope. Revoking a
 * platform_super_admin assignment also needs another active platform administrator.
 */
export function canRevokeRole(
  grantor: AuthorizationSnapshot,
  roleKey: string,
  target: Target,
  now: Date = new Date(),
  otherActivePlatformAdmins?: number,
): EscalationDecision {
  const role = ROLE_BY_KEY.get(roleKey);
  if (!role) return { allowed: false, reason: "unknown_role" };
  if ((role.scopeType === "PLATFORM") !== (target.scope === "platform")) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  const may = decide(grantor, "role_assignment:revoke", target, now);
  if (!may.allowed) {
    return {
      allowed: false,
      reason: may.reason === "mfa_required" ? "mfa_required" : "not_allowed",
    };
  }
  if (platformAdminRemovalProblem(roleKey === PLATFORM_SUPER_ADMIN, otherActivePlatformAdmins)) {
    return { allowed: false, reason: "last_platform_admin" };
  }
  return { allowed: true };
}

// ===========================================================================================
// Target superiority for user administration (F1-002, ADR-013; design 10.3 and 10.5)
// ===========================================================================================

/**
 * Permissions whose target is another staff user and which need target superiority. `user:invite`
 * is here for re-issuing an enrolment link to a PENDING user (F1-002 Group 2): the link holder
 * activates the account with all its grants, so the actor must dominate them too.
 */
export const USER_ADMIN_ACTIONS = [
  "user:invite",
  "mfa:reset",
  "user:suspend",
  "user:reactivate",
  "user:unlock",
  "session:revoke",
  "user:deactivate",
] as const;
export type UserAdminAction = (typeof USER_ADMIN_ACTIONS)[number];

/** The user an administrator wants to act on, as loaded from the database. */
export interface ActTarget {
  userId: string;
  kind: UserKindValue;
  status: UserStatusValue;
  /** The target's role assignments (inactive ones are ignored). */
  grants: readonly Grant[];
  /** Sites where the target has a membership that is not REVOKED. */
  membershipSiteIds: ReadonlySet<string>;
  /** DP-108: the target is the system owner, whom no administrator can act on. */
  isSystemOwner?: boolean;
}

export interface ActContext {
  now?: Date;
  /**
   * For removing a platform administrator (deactivate, platform suspension): the platform
   * administrators that would remain, i.e. everyone except the target who is ACTIVE,
   * MFA-enrolled and holds a non-expiring platform_super_admin assignment. The actor counts
   * (owner decision, PR #12): `countQualifiedPlatformAdmins(db, [targetId])`. Unknown counts as
   * zero (deny by default).
   */
  remainingQualifiedPlatformAdmins?: number;
}

export type ActDenyReason =
  | "unknown_action"
  | "not_allowed"
  | "mfa_required"
  | "out_of_scope"
  | "self"
  | "customer_target"
  | "not_superior"
  | "ancestry_unknown"
  | "target_is_ancestor"
  | "invalid_state"
  | "last_platform_admin";

export type ActDecision =
  { allowed: true } | { allowed: false; reason: ActDenyReason; status: 403 | 404 | 409 };

const actDeny = (reason: ActDenyReason, status: 403 | 404 | 409): ActDecision => ({
  allowed: false,
  reason,
  status,
});

function isActivePlatformAdmin(target: ActTarget, now: Date): boolean {
  return (
    (target.status === "ACTIVE" || target.status === "PENDING") &&
    target.grants.some(
      (g) =>
        g.roleKey === PLATFORM_SUPER_ADMIN && g.scopeType === "PLATFORM" && isGrantActive(g, now),
    )
  );
}

/**
 * Whether `actor` may perform `action` on the staff user `target` at `requestTarget` (the scope
 * the request names: a site for a membership action, the platform for an account action).
 * Called by the administration endpoints after loading both users; the database repeats the
 * last-administrator rule with triggers.
 *
 * Rules (design 10.3, 10.5):
 *  0. `decide(actor, action, requestTarget)` allows it (this includes the step-up).
 *  1. The target is visible: the actor holds the permission platform-wide, or on a site where the
 *     target has a grant or membership. Otherwise 404, so out-of-scope users look missing.
 *  2. actor ≠ target.
 *  3. The target is staff (customer moderation needs membership:manage, DP-076).
 *  4. Every active grant of the target is covered by actor grants that carry the same
 *     permission: a PLATFORM grant needs the actor's platform grant; a SITE grant needs the actor's
 *     grant on that site or platform-wide. A platform-scoped permission (user:deactivate) is held
 *     platform-wide only.
 *  5. The target is not in the actor's grant ancestry.
 *  6. State: a DEACTIVATED target is terminal (409); reactivate needs a SUSPENDED target.
 *  1a. DP-108: the system owner is never a target (404, so the account looks missing); the
 *     database refuses the same changes (iam_owner_*_guard).
 *  7. Removing a platform administrator (deactivate, or a platform-level suspension) needs at
 *     least one ACTIVE, MFA-enrolled, non-expiring platform administrator to remain; the actor
 *     counts (409). The F1-001 database guards (`User_last_platform_admin`,
 *     `RoleAssignment_last_platform_admin`) stay as the backstop; they are weaker (they also count
 *     PENDING and time-limited administrators), so this check is the binding one.
 */
export function canActOnUser(
  actor: AuthorizationSnapshot,
  target: ActTarget,
  action: string,
  requestTarget: Target,
  ctx: ActContext = {},
): ActDecision {
  const now = ctx.now ?? new Date();
  const permission = PERMISSION_BY_KEY.get(action);
  if (!permission || !(USER_ADMIN_ACTIONS as readonly string[]).includes(action)) {
    return actDeny("unknown_action", 403);
  }

  const may = decide(actor, action, requestTarget, now);
  if (!may.allowed) {
    return actDeny(may.reason === "mfa_required" ? "mfa_required" : "not_allowed", 403);
  }

  if (target.isSystemOwner) return actDeny("out_of_scope", 404);

  const platform: Target = { scope: "platform" };
  const heldAt = (t: Target): boolean =>
    heldPermissions(actor, permission.scopeType === "PLATFORM" ? platform : t, now).has(action);

  // 1. Visibility: a site target must be one where the target user works.
  const holdsPlatformWide = heldAt(platform);
  const targetSites = new Set<string>(target.membershipSiteIds);
  for (const g of target.grants) {
    if (g.siteId && isGrantActive(g, now)) targetSites.add(g.siteId);
  }
  const visible =
    requestTarget.scope === "platform"
      ? holdsPlatformWide
      : targetSites.has(requestTarget.siteId) && heldAt(requestTarget);
  if (!visible) return actDeny("out_of_scope", 404);

  // 2-3.
  if (actor.principal.userId === target.userId) return actDeny("self", 403);
  if (target.kind !== "STAFF") return actDeny("customer_target", 404);

  // 4. Superiority over every active grant of the target.
  for (const g of target.grants) {
    if (!isGrantActive(g, now)) continue;
    const covered =
      g.scopeType === "PLATFORM"
        ? holdsPlatformWide
        : g.siteId !== null && heldAt({ scope: "site", siteId: g.siteId });
    if (!covered) return actDeny("not_superior", 403);
  }

  // 5. Never act on someone who (directly or through a chain) granted the actor's roles.
  if (!actor.grantAncestry) return actDeny("ancestry_unknown", 403);
  if (actor.grantAncestry.has(target.userId)) return actDeny("target_is_ancestor", 403);

  // 6. State.
  if (target.status === "DEACTIVATED") return actDeny("invalid_state", 409);
  if (action === "user:reactivate" && requestTarget.scope === "platform") {
    if (target.status !== "SUSPENDED") return actDeny("invalid_state", 409);
  }

  // 7. Last administrator.
  const removesAccount =
    action === "user:deactivate" ||
    (action === "user:suspend" && requestTarget.scope === "platform");
  if (removesAccount && isActivePlatformAdmin(target, now)) {
    if ((ctx.remainingQualifiedPlatformAdmins ?? 0) < 1) {
      return actDeny("last_platform_admin", 409);
    }
  }
  return { allowed: true };
}
