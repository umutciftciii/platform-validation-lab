// AC-RB-1, AC-RB-2 (F1-002 Group 1): the four new permissions and canActOnUser (design 10.1,
// 10.3, 10.5). Table tests over synthetic snapshots; the HTTP endpoints arrive in Group 2.
import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  canActOnUser,
  USER_ADMIN_ACTIONS,
  type ActTarget,
} from "../../../src/iam/escalation.js";
import { PERMISSION_BY_KEY, ROLE_BY_KEY } from "../../../src/iam/catalog.js";
import { BV, COM, NOW, grant, snapshot } from "./fixtures.js";
import type { Grant } from "../../../src/iam/authorization.js";

const bv = { scope: "site", siteId: BV } as const;
const com = { scope: "site", siteId: COM } as const;
const platform = { scope: "platform" } as const;

const superAdmin = snapshot([grant("platform_super_admin", null)]);
const siteAdminBv = snapshot([grant("site_admin", BV)]);

function target(grants: Grant[], extra: Partial<ActTarget> = {}): ActTarget {
  return {
    userId: "target-1",
    kind: "STAFF",
    status: "ACTIVE",
    grants,
    membershipSiteIds: new Set(grants.flatMap((g) => (g.siteId ? [g.siteId] : []))),
    ...extra,
  };
}

const editorBv = target([grant("content_editor", BV)]);
const editorCom = target([grant("content_editor", COM)]);
const otherAdmin = target([grant("platform_super_admin", null)]);

describe("catalogue: user administration permissions (AC-RB-1, design 10.1)", () => {
  it("adds the four permissions with the agreed scope, step-up and customer-data flags", () => {
    const expected = {
      "user:reactivate": "SITE",
      "user:unlock": "SITE",
      "session:revoke": "SITE",
      "user:deactivate": "PLATFORM",
    } as const;
    for (const [key, scope] of Object.entries(expected)) {
      const p = PERMISSION_BY_KEY.get(key);
      expect(p, key).toMatchObject({
        module: "rbac",
        scopeType: scope,
        sensitive: true,
        customerData: false,
        audience: "STAFF",
      });
    }
  });

  it("gives all four to the super admin and only reactivate/unlock to the site admin (Ö3)", () => {
    const sa = ROLE_BY_KEY.get("platform_super_admin")!.permissions;
    const site = ROLE_BY_KEY.get("site_admin")!.permissions;
    for (const k of ["user:reactivate", "user:unlock", "session:revoke", "user:deactivate"]) {
      expect(sa, k).toContain(k);
    }
    expect(site).toContain("user:reactivate");
    expect(site).toContain("user:unlock");
    expect(site).not.toContain("session:revoke");
    expect(site).not.toContain("user:deactivate");
    for (const k of ["user:suspend", "mfa:reset", "user:invite"]) {
      expect(sa, k).toContain(k);
      expect(site, k).toContain(k);
    }
    // No other role gained any of them.
    for (const role of ROLE_BY_KEY.values()) {
      // DP-108: the system owner carries every staff permission (never assigned).
      if (["platform_super_admin", "site_admin", "system_owner"].includes(role.key)) continue;
      for (const k of ["user:reactivate", "user:unlock", "session:revoke", "user:deactivate"]) {
        expect(role.permissions, `${role.key} ${k}`).not.toContain(k);
      }
    }
  });

  it("keeps the existing assignment paths working (design 10.2)", () => {
    const assignee = { userId: "new-1", kind: "STAFF" as const, status: "ACTIVE" as const };
    expect(canAssignRole(superAdmin, assignee, "site_admin", bv, NOW)).toEqual({ allowed: true });
    expect(canAssignRole(siteAdminBv, assignee, "site_admin", bv, NOW)).toEqual({ allowed: true });
    expect(canAssignRole(superAdmin, assignee, "platform_super_admin", platform, NOW)).toEqual({
      allowed: true,
    });
  });
});

describe("canActOnUser (AC-RB-2, design 10.3)", () => {
  const cases: [string, Parameters<typeof canActOnUser>, ReturnType<typeof canActOnUser>][] = [
    [
      "super admin suspends a BV editor platform-wide",
      [superAdmin, editorBv, "user:suspend", platform, { remainingQualifiedPlatformAdmins: 0 }],
      { allowed: true },
    ],
    [
      "site admin suspends a BV editor on BV",
      [siteAdminBv, editorBv, "user:suspend", bv],
      { allowed: true },
    ],
    [
      "site admin unlocks and reactivates a BV editor",
      [siteAdminBv, editorBv, "user:unlock", bv],
      { allowed: true },
    ],
    [
      "NT-R2: BV site admin cannot see a CORPORATE-only editor",
      [siteAdminBv, editorCom, "user:suspend", com],
      { allowed: false, reason: "not_allowed", status: 403 },
    ],
    [
      "NT-R2: … nor through its own site",
      [siteAdminBv, editorCom, "user:suspend", bv],
      { allowed: false, reason: "out_of_scope", status: 404 },
    ],
    [
      "NT-R1: site admin on a platform admin who also works on BV",
      [
        siteAdminBv,
        target([grant("platform_super_admin", null)], { membershipSiteIds: new Set([BV]) }),
        "mfa:reset",
        bv,
      ],
      { allowed: false, reason: "not_superior", status: 403 },
    ],
    [
      "NT-R1: site admin on a platform admin without a BV link",
      [siteAdminBv, otherAdmin, "user:unlock", bv],
      { allowed: false, reason: "out_of_scope", status: 404 },
    ],
    [
      "NT-R7: site admin cannot revoke sessions",
      [siteAdminBv, editorBv, "session:revoke", bv],
      { allowed: false, reason: "not_allowed", status: 403 },
    ],
    [
      "NT-R7: site admin cannot deactivate",
      [siteAdminBv, editorBv, "user:deactivate", platform],
      { allowed: false, reason: "not_allowed", status: 403 },
    ],
    [
      "NT-R8: customers are not user-administration targets",
      [
        superAdmin,
        target([], { kind: "CUSTOMER", membershipSiteIds: new Set([BV]) }),
        "user:suspend",
        platform,
      ],
      { allowed: false, reason: "customer_target", status: 404 },
    ],
    [
      "target with BV and CORPORATE grants is beyond a BV site admin",
      [
        siteAdminBv,
        target([grant("content_editor", BV), grant("read_only", COM)]),
        "user:suspend",
        bv,
      ],
      { allowed: false, reason: "not_superior", status: 403 },
    ],
    [
      "super admin may act on another platform admin when one more remains",
      [superAdmin, otherAdmin, "mfa:reset", platform],
      { allowed: true },
    ],
    [
      "unknown action",
      [superAdmin, editorBv, "content:edit", platform],
      { allowed: false, reason: "unknown_action", status: 403 },
    ],
  ];
  for (const [name, args, expected] of cases) {
    it(name, () => expect(canActOnUser(...args)).toEqual(expected));
  }

  it("NT-R3: nobody acts on themselves, for any of the six actions", () => {
    const me = target([grant("platform_super_admin", null)], {
      userId: superAdmin.principal.userId,
    });
    for (const action of USER_ADMIN_ACTIONS) {
      const scope = action === "user:deactivate" ? platform : platform;
      expect(
        canActOnUser(superAdmin, me, action, scope, { remainingQualifiedPlatformAdmins: 5 }),
        action,
      ).toEqual({ allowed: false, reason: "self", status: 403 });
    }
  });

  it("NT-R4: never acts on someone in the actor's grant ancestry; unknown ancestry denies", () => {
    const actor = snapshot([grant("site_admin", BV)], { ancestry: ["target-1"] });
    expect(canActOnUser(actor, editorBv, "user:suspend", bv)).toEqual({
      allowed: false,
      reason: "target_is_ancestor",
      status: 403,
    });
    const unknown = { ...siteAdminBv, grantAncestry: undefined };
    expect(canActOnUser(unknown, editorBv, "user:suspend", bv)).toEqual({
      allowed: false,
      reason: "ancestry_unknown",
      status: 403,
    });
  });

  it("NT-R6: needs a fresh MFA step-up", () => {
    const stale = snapshot([grant("platform_super_admin", null)], {
      principal: { mfaVerified: false },
    });
    expect(canActOnUser(stale, editorBv, "user:unlock", platform)).toEqual({
      allowed: false,
      reason: "mfa_required",
      status: 403,
    });
  });

  it("ignores expired and revoked grants of the target", () => {
    const t = target([
      grant("content_editor", BV),
      grant("read_only", COM, { revokedAt: new Date(NOW.getTime() - 1000) }),
      grant("platform_super_admin", null, { expiresAt: new Date(NOW.getTime() - 1000) }),
    ]);
    expect(canActOnUser(siteAdminBv, t, "user:suspend", bv, { now: NOW })).toEqual({
      allowed: true,
    });
  });
});

describe("canActOnUser: deactivate and last administrator (design 10.5)", () => {
  it("lets only the super admin deactivate, at platform scope", () => {
    expect(canActOnUser(superAdmin, editorBv, "user:deactivate", platform)).toEqual({
      allowed: true,
    });
    expect(canActOnUser(superAdmin, editorBv, "user:deactivate", bv)).toEqual({
      allowed: false,
      reason: "not_allowed",
      status: 403,
    });
  });

  it("NT-D3: refuses removing a platform admin when no qualified one would remain", () => {
    for (const action of ["user:deactivate", "user:suspend"] as const) {
      expect(
        canActOnUser(superAdmin, otherAdmin, action, platform, {
          remainingQualifiedPlatformAdmins: 0,
        }),
        action,
      ).toEqual({ allowed: false, reason: "last_platform_admin", status: 409 });
      expect(
        canActOnUser(superAdmin, otherAdmin, action, platform),
        `${action} unknown count`,
      ).toEqual({
        allowed: false,
        reason: "last_platform_admin",
        status: 409,
      });
      expect(
        canActOnUser(superAdmin, otherAdmin, action, platform, {
          remainingQualifiedPlatformAdmins: 1,
        }),
      ).toEqual({ allowed: true });
    }
    // Two administrators are enough: the actor itself is the one that remains (no third needed).
    expect(
      canActOnUser(superAdmin, otherAdmin, "user:deactivate", platform, {
        remainingQualifiedPlatformAdmins: 1,
      }),
    ).toEqual({ allowed: true });
    // A PENDING platform admin still counts as an administrator being removed.
    const pending = target([grant("platform_super_admin", null)], { status: "PENDING" });
    expect(canActOnUser(superAdmin, pending, "user:deactivate", platform)).toMatchObject({
      reason: "last_platform_admin",
    });
  });

  it("NT-D5: a DEACTIVATED target is terminal; platform reactivation needs SUSPENDED", () => {
    const gone = target([grant("content_editor", BV)], { status: "DEACTIVATED" });
    for (const action of USER_ADMIN_ACTIONS) {
      expect(canActOnUser(superAdmin, gone, action, platform), action).toEqual({
        allowed: false,
        reason: "invalid_state",
        status: 409,
      });
    }
    expect(canActOnUser(superAdmin, editorBv, "user:reactivate", platform)).toEqual({
      allowed: false,
      reason: "invalid_state",
      status: 409,
    });
    const suspended = target([grant("content_editor", BV)], { status: "SUSPENDED" });
    expect(canActOnUser(superAdmin, suspended, "user:reactivate", platform)).toEqual({
      allowed: true,
    });
  });
});

describe("canActOnUser: the system owner is out of reach (DP-108, condition 7)", () => {
  const ownerTarget = target([grant("platform_super_admin", null)], { isSystemOwner: true });

  it("refuses every administration action on the owner as if the account did not exist", () => {
    for (const action of USER_ADMIN_ACTIONS) {
      const scope = PERMISSION_BY_KEY.get(action)?.scopeType === "PLATFORM" ? platform : platform;
      expect(
        canActOnUser(superAdmin, ownerTarget, action, scope, {
          now: NOW,
          remainingQualifiedPlatformAdmins: 5,
        }),
        action,
      ).toEqual({ allowed: false, reason: "out_of_scope", status: 404 });
    }
    expect(canActOnUser(superAdmin, ownerTarget, "user:suspend", bv, { now: NOW })).toMatchObject({
      allowed: false,
      status: 404,
    });
  });

  it("leaves other platform administrators to the existing rules", () => {
    expect(
      canActOnUser(superAdmin, otherAdmin, "user:suspend", platform, {
        now: NOW,
        remainingQualifiedPlatformAdmins: 1,
      }),
    ).toEqual({ allowed: true });
  });
});
