import type { AuthorizationSnapshot, Grant, Principal } from "../../../src/iam/authorization.js";

export const BV = "00000000-0000-7000-8000-0000000000b1";
export const COM = "00000000-0000-7000-8000-0000000000c1";
export const SITES = [BV, COM];
export const NOW = new Date("2026-11-10T12:00:00Z");

export function grant(roleKey: string, siteId: string | null, extra: Partial<Grant> = {}): Grant {
  return {
    roleKey,
    scopeType: siteId === null ? "PLATFORM" : "SITE",
    siteId,
    expiresAt: null,
    revokedAt: null,
    ...extra,
  };
}

export function snapshot(
  grants: Grant[],
  opts: {
    principal?: Partial<Principal>;
    memberships?: string[];
    enabled?: Record<string, string[]>;
    ancestry?: string[];
    /** DP-108: the principal is the system owner. */
    owner?: boolean;
  } = {},
): AuthorizationSnapshot {
  return {
    principal: {
      userId: "user-1",
      kind: "STAFF",
      status: "ACTIVE",
      mfaVerified: true,
      ...opts.principal,
    },
    grants,
    activeMembershipSiteIds: new Set(
      opts.memberships ?? grants.flatMap((g) => (g.siteId ? [g.siteId] : [])),
    ),
    enabledOptionalModules: new Map(
      Object.entries(opts.enabled ?? {}).map(([site, mods]) => [site, new Set(mods)]),
    ),
    grantAncestry: new Set(opts.ancestry ?? []),
    ...(opts.owner ? { isSystemOwner: true } : {}),
  };
}
