import { describe, expect, it } from "vitest";
import { accessibleScope, decide, heldPermissions } from "../../../src/iam/authorization.js";
import { PERMISSIONS, RETIRED_PERMISSIONS } from "../../../src/iam/catalog.js";
import { SYSTEM_OWNER_GRANT } from "../../../src/iam/repository.js";
import { BV, COM, NOW, SITES, grant, snapshot } from "./fixtures.js";

const bv = { scope: "site", siteId: BV } as const;
const com = { scope: "site", siteId: COM } as const;
const platform = { scope: "platform" } as const;

describe("decide: deny by default", () => {
  it("denies a principal without grants for every permission and target", () => {
    const s = snapshot([], { memberships: SITES });
    for (const p of PERMISSIONS) {
      for (const target of [bv, com, platform]) {
        expect(decide(s, p.key, target, NOW).allowed).toBe(false);
      }
    }
  });

  it("denies unknown permissions, even for the platform super admin", () => {
    const s = snapshot([grant("platform_super_admin", null)]);
    expect(decide(s, "content:delete_everything", bv, NOW)).toEqual({
      allowed: false,
      reason: "unknown_permission",
    });
    expect(decide(s, "*", platform, NOW).allowed).toBe(false);
  });

  it.each(["PENDING", "SUSPENDED", "DEACTIVATED"] as const)("denies a %s principal", (status) => {
    const s = snapshot([grant("platform_super_admin", null)], { principal: { status } });
    expect(decide(s, "content:read", bv, NOW)).toEqual({
      allowed: false,
      reason: "principal_inactive",
    });
  });

  it("ignores revoked and expired grants", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(
      decide(snapshot([grant("site_admin", BV, { revokedAt: past })]), "content:read", bv, NOW)
        .allowed,
    ).toBe(false);
    expect(
      decide(snapshot([grant("site_admin", BV, { expiresAt: past })]), "content:read", bv, NOW)
        .allowed,
    ).toBe(false);
    const future = new Date(NOW.getTime() + 60_000);
    expect(
      decide(snapshot([grant("site_admin", BV, { expiresAt: future })]), "content:read", bv, NOW)
        .allowed,
    ).toBe(true);
  });

  it("ignores grants of unknown roles or with a scope that contradicts the role", () => {
    expect(decide(snapshot([grant("god", null)]), "content:read", bv, NOW).allowed).toBe(false);
    // A site role stored as a platform grant (tampered row) must not become platform-wide.
    const tampered = grant("site_admin", null);
    expect(
      decide(snapshot([tampered], { memberships: SITES }), "content:read", bv, NOW).allowed,
    ).toBe(false);
    const platformAsSite = grant("platform_super_admin", BV);
    expect(decide(snapshot([platformAsSite]), "module:manage", platform, NOW).allowed).toBe(false);
  });
});

describe("decide: site isolation (BV editor must not see COM records)", () => {
  const editor = snapshot([grant("content_editor", BV)]);

  it("allows the BV editor on BV", () => {
    expect(decide(editor, "content:edit", bv, NOW)).toEqual({ allowed: true });
  });

  it("denies the BV editor on COM", () => {
    expect(decide(editor, "content:read", com, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
  });

  it("denies a site role platform-wide", () => {
    expect(decide(editor, "content:read", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
  });

  it("counts a site grant only while the membership of that site is ACTIVE", () => {
    const noMembership = snapshot([grant("content_editor", BV)], { memberships: [] });
    expect(decide(noMembership, "content:read", bv, NOW).allowed).toBe(false);
  });

  it("keeps grants on two sites separate", () => {
    const s = snapshot([grant("content_editor", BV), grant("read_only", COM)]);
    expect(decide(s, "content:edit", bv, NOW).allowed).toBe(true);
    expect(decide(s, "content:edit", com, NOW).allowed).toBe(false);
    expect(decide(s, "content:read", com, NOW).allowed).toBe(true);
  });

  it("gives customer data of one site only to roles of that site", () => {
    const sales = snapshot([grant("sales_crm_user", COM)]);
    expect(decide(sales, "lead:read", com, NOW).allowed).toBe(true);
    expect(decide(sales, "lead:read", bv, NOW).allowed).toBe(false);
  });
});

describe("decide: platform scope", () => {
  const admin = snapshot([grant("platform_super_admin", null)]);

  it("lets the platform super admin act on every site without a membership", () => {
    expect(decide(admin, "content:review", bv, NOW).allowed).toBe(true);
    expect(decide(admin, "content:review", com, NOW).allowed).toBe(true);
    expect(decide(admin, "product:approve", platform, NOW).allowed).toBe(true);
  });

  it("checks platform permissions only without a site", () => {
    expect(decide(admin, "site:manage", platform, NOW)).toEqual({ allowed: true });
    expect(decide(admin, "site:manage", bv, NOW)).toEqual({
      allowed: false,
      reason: "platform_permission",
    });
  });

  it("never lets a site admin use God Mode", () => {
    const siteAdmin = snapshot([grant("site_admin", BV)]);
    expect(decide(siteAdmin, "module:manage", platform, NOW).allowed).toBe(false);
    expect(decide(siteAdmin, "module:read", platform, NOW).allowed).toBe(false);
  });
});

describe("decide: customer and lead data (F1-001A)", () => {
  const superAdmin = snapshot([grant("platform_super_admin", null)]);
  const customerData = [
    "lead:read",
    "lead:manage",
    "lead:export",
    "membership:read",
    "membership:manage",
    "crm:read",
    "crm:manage",
  ];

  it("gives the platform super admin lead and CRM data on every site (DP-076 revision)", () => {
    const withCrm = snapshot([grant("platform_super_admin", null)], {
      enabled: { [BV]: ["crm"], [COM]: ["crm"] },
    });
    for (const key of customerData) {
      for (const target of [bv, com]) {
        // membership:manage keeps its step-up (account-level action).
        expect(decide(withCrm, key, target, NOW).allowed, `${key}`).toBe(true);
      }
    }
    // Optional modules still apply: CRM is off unless enabled for the site.
    expect(decide(superAdmin, "crm:read", bv, NOW).allowed).toBe(false);
    expect(accessibleScope(superAdmin, "lead:read", SITES, NOW).siteIds.sort()).toEqual(
      [...SITES].sort(),
    );
  });

  it("gives other staff platform-wide customer data only through the officer role", () => {
    const officer = snapshot([grant("platform_customer_data_officer", null)]);
    expect(decide(officer, "lead:read", bv, NOW).allowed).toBe(true);
    expect(decide(officer, "lead:read", com, NOW).allowed).toBe(true);
    expect(decide(officer, "lead:export", com, NOW).allowed).toBe(true);
    expect(decide(officer, "lead:manage", bv, NOW).allowed).toBe(false);
    expect(decide(officer, "content:read", bv, NOW).allowed).toBe(false);
    expect(decide(officer, "module:manage", platform, NOW).allowed).toBe(false);
    // Both roles together: the officer role adds the data, nothing else changes.
    const both = snapshot([
      grant("platform_super_admin", null),
      grant("platform_customer_data_officer", null),
    ]);
    expect(decide(both, "lead:read", bv, NOW).allowed).toBe(true);
  });

  it("keeps customer data out of site_admin; only the site's sales role reads its leads", () => {
    const siteAdmin = snapshot([grant("site_admin", BV)]);
    for (const target of [bv, com, platform]) {
      expect(decide(siteAdmin, "lead:read", target, NOW).allowed).toBe(false);
      expect(decide(siteAdmin, "membership:read", target, NOW).allowed).toBe(false);
    }
    const sales = snapshot([grant("sales_crm_user", BV)]);
    expect(decide(sales, "lead:read", bv, NOW).allowed).toBe(true);
    expect(decide(sales, "lead:read", com, NOW).allowed).toBe(false);
  });
});

describe("decide: publishing (F1-001A, F1-001B)", () => {
  it("lets site_admin publish on its own site only", () => {
    const siteAdmin = snapshot([grant("site_admin", BV)]);
    for (const key of ["content:publish", "product:publish"]) {
      expect(decide(siteAdmin, key, bv, NOW).allowed, key).toBe(true);
      expect(decide(siteAdmin, key, com, NOW).allowed, key).toBe(false);
      expect(decide(siteAdmin, key, platform, NOW).allowed, key).toBe(false);
    }
  });

  it("never lets the super admin publish automatically, on any site", () => {
    const admin = snapshot([grant("platform_super_admin", null)]);
    for (const key of ["content:publish", "product:publish"]) {
      for (const target of [bv, com, platform]) {
        expect(decide(admin, key, target, NOW).allowed, key).toBe(false);
      }
    }
    expect(decide(admin, "publisher_role:grant", platform, NOW).allowed).toBe(true);
  });

  it("lets editors write drafts but not publish", () => {
    const editor = snapshot([grant("content_editor", BV), grant("product_editor", BV)]);
    expect(decide(editor, "content:edit", bv, NOW).allowed).toBe(true);
    expect(decide(editor, "product:edit", bv, NOW).allowed).toBe(true);
    expect(decide(editor, "content:publish", bv, NOW).allowed).toBe(false);
    expect(decide(editor, "product:publish", bv, NOW).allowed).toBe(false);
    expect(decide(editor, "product:approve", bv, NOW).allowed).toBe(false);
  });

  it("lets publishers publish on their own site but not edit", () => {
    const publisher = snapshot([grant("content_publisher", BV), grant("product_publisher", BV)]);
    expect(decide(publisher, "content:publish", bv, NOW).allowed).toBe(true);
    expect(decide(publisher, "product:publish", bv, NOW).allowed).toBe(true);
    expect(decide(publisher, "content:publish", com, NOW).allowed).toBe(false);
    expect(decide(publisher, "content:edit", bv, NOW).allowed).toBe(false);
    expect(decide(publisher, "product:edit", bv, NOW).allowed).toBe(false);
  });
});

describe("decide: MFA step-up and audiences", () => {
  it("requires a verified MFA session for sensitive permissions", () => {
    const s = snapshot([grant("platform_super_admin", null)], {
      principal: { mfaVerified: false },
    });
    expect(decide(s, "site:manage", platform, NOW)).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(decide(s, "user:suspend", bv, NOW)).toEqual({ allowed: false, reason: "mfa_required" });
    expect(decide(s, "content:read", bv, NOW)).toEqual({ allowed: true });
  });

  it("does not reveal mfa_required to a principal without the grant", () => {
    const s = snapshot([grant("read_only", BV)], { principal: { mfaVerified: false } });
    expect(decide(s, "lead:export", bv, NOW)).toEqual({ allowed: false, reason: "no_grant" });
  });

  it("keeps staff and customer permissions apart", () => {
    const member = snapshot([grant("member", BV)], { principal: { kind: "CUSTOMER" } });
    expect(decide(member, "technical_spec:view", bv, NOW).allowed).toBe(true);
    expect(decide(member, "technical_spec:view", com, NOW).allowed).toBe(false);
    expect(decide(member, "content:read", bv, NOW)).toEqual({
      allowed: false,
      reason: "audience_mismatch",
    });
    const admin = snapshot([grant("platform_super_admin", null)]);
    expect(decide(admin, "technical_spec:view", bv, NOW)).toEqual({
      allowed: false,
      reason: "audience_mismatch",
    });
  });

  it("ignores a staff role held by a customer (e.g. a tampered row)", () => {
    const s = snapshot([grant("site_admin", BV)], { principal: { kind: "CUSTOMER" } });
    expect(decide(s, "technical_spec:view", bv, NOW).allowed).toBe(false);
  });
});

describe("decide: feature modules", () => {
  const sales = snapshot([grant("sales_crm_user", BV)]);

  it("denies optional-module permissions until the module is enabled for that site", () => {
    expect(decide(sales, "crm:read", bv, NOW)).toEqual({
      allowed: false,
      reason: "module_disabled",
    });
    const enabled = snapshot([grant("sales_crm_user", BV)], { enabled: { [BV]: ["crm"] } });
    expect(decide(enabled, "crm:read", bv, NOW)).toEqual({ allowed: true });
    const otherSite = snapshot([grant("sales_crm_user", BV)], { enabled: { [COM]: ["crm"] } });
    expect(decide(otherSite, "crm:read", bv, NOW).allowed).toBe(false);
  });

  it("needs a site for optional-module permissions, even for platform roles", () => {
    const admin = snapshot([grant("platform_customer_data_officer", null)], {
      enabled: { [BV]: ["crm"] },
    });
    expect(decide(admin, "crm:read", platform, NOW)).toEqual({
      allowed: false,
      reason: "site_required",
    });
    expect(decide(admin, "crm:read", bv, NOW).allowed).toBe(true);
  });

  it("treats core modules as always enabled", () => {
    expect(decide(sales, "lead:read", bv, NOW).allowed).toBe(true);
  });
});

describe("heldPermissions and accessibleScope", () => {
  it("lists what a role holds on a site", () => {
    const held = heldPermissions(
      snapshot([grant("read_only", BV)]),
      { scope: "site", siteId: BV },
      NOW,
    );
    expect([...held].sort()).toEqual(["content:read", "media:read", "product:read"]);
  });

  it("scopes queries to the sites where the permission is allowed", () => {
    expect(
      accessibleScope(snapshot([grant("compliance_reviewer", BV)]), "audit:read", SITES, NOW),
    ).toEqual({
      siteIds: [BV],
      includePlatform: false,
    });
    expect(
      accessibleScope(snapshot([grant("platform_super_admin", null)]), "audit:read", SITES, NOW),
    ).toEqual({
      siteIds: SITES,
      includePlatform: true,
    });
    expect(accessibleScope(snapshot([]), "audit:read", SITES, NOW)).toEqual({
      siteIds: [],
      includePlatform: false,
    });
  });
});

describe("decide: the system owner's God Mode (DP-108, ADR-018)", () => {
  const owner = (opts: Parameters<typeof snapshot>[1] = {}) =>
    snapshot([SYSTEM_OWNER_GRANT], { owner: true, ...opts });

  it("keeps God Mode away from the super admin (K1): module switches and the protected stream", () => {
    const admin = snapshot([grant("platform_super_admin", null)]);
    expect(decide(admin, "module:manage", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
    expect(decide(admin, "owner_audit:read", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
    // Reading the module catalogue stays with the super admin.
    expect(decide(admin, "module:read", platform, NOW).allowed).toBe(true);
  });

  it("ignores a system_owner grant unless the principal is the recorded owner", () => {
    const forged = snapshot([SYSTEM_OWNER_GRANT]);
    for (const p of PERMISSIONS) {
      for (const target of [bv, com, platform]) {
        expect(decide(forged, p.key, target, NOW).allowed, p.key).toBe(false);
      }
    }
    expect(heldPermissions(forged, platform, NOW).size).toBe(0);
  });

  it("gives the owner every staff permission on every site, publishing included (K4)", () => {
    const s = owner({ enabled: { [BV]: ["crm", "automation", "integrations"] } });
    for (const p of PERMISSIONS.filter((x) => x.audience === "STAFF")) {
      const target = p.scopeType === "PLATFORM" ? platform : bv;
      const expected = !RETIRED_PERMISSIONS.includes(p.key);
      expect(decide(s, p.key, target, NOW).allowed, p.key).toBe(expected);
    }
    expect(decide(s, "content:publish", com, NOW).allowed).toBe(true);
    expect(decide(s, "product:publish", com, NOW).allowed).toBe(true);
    // Customer permissions are not staff permissions: the owner is no member.
    expect(decide(s, "portal:access", bv, NOW)).toEqual({
      allowed: false,
      reason: "audience_mismatch",
    });
  });

  it("keeps a disabled module closed for the owner but always lets it switch modules (condition 4)", () => {
    const s = owner();
    expect(decide(s, "crm:read", bv, NOW)).toEqual({ allowed: false, reason: "module_disabled" });
    expect(decide(s, "integration:manage", bv, NOW)).toEqual({
      allowed: false,
      reason: "module_disabled",
    });
    expect(decide(s, "module:manage", platform, NOW)).toEqual({ allowed: true });
    expect(decide(s, "module:read", platform, NOW)).toEqual({ allowed: true });
  });

  it("still needs the MFA step-up and an active account (no bypass, condition 5)", () => {
    const stale = owner({ principal: { mfaVerified: false } });
    expect(decide(stale, "module:manage", platform, NOW)).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(decide(stale, "owner_audit:read", platform, NOW)).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(decide(stale, "content:read", bv, NOW).allowed).toBe(true);
    for (const status of ["PENDING", "SUSPENDED", "DEACTIVATED"] as const) {
      expect(decide(owner({ principal: { status } }), "content:read", bv, NOW)).toEqual({
        allowed: false,
        reason: "principal_inactive",
      });
    }
  });
});
