import { describe, expect, it } from "vitest";
import { heldPermissions } from "../../../src/iam/authorization.js";
import {
  ROLES,
  isAssignableRole,
  isCustomerDataRole,
  type RoleDef,
} from "../../../src/iam/catalog.js";
import { SYSTEM_OWNER_GRANT } from "../../../src/iam/repository.js";
import {
  canAssignRole,
  canRevokeRole,
  platformAdminExpiryProblem,
  platformAdminRemovalProblem,
  type Assignee,
} from "../../../src/iam/escalation.js";
import { BV, COM, NOW, grant, snapshot } from "./fixtures.js";

const bv = { scope: "site", siteId: BV } as const;
const com = { scope: "site", siteId: COM } as const;
const platform = { scope: "platform" } as const;
const staff: Assignee = { userId: "user-2", kind: "STAFF", status: "ACTIVE" };
const customer: Assignee = { userId: "user-3", kind: "CUSTOMER", status: "ACTIVE" };
const siteAdmin = snapshot([grant("site_admin", BV)]);
const superAdmin = snapshot([grant("platform_super_admin", null)]);

describe("canAssignRole: basics (no privilege escalation)", () => {
  it("lets a site admin grant site roles on its own site, publishers included", () => {
    for (const role of ["content_editor", "content_publisher", "product_publisher", "site_admin"]) {
      expect(canAssignRole(siteAdmin, staff, role, bv, NOW), role).toEqual({ allowed: true });
    }
  });

  it("does not let a site admin grant anything on another site", () => {
    expect(canAssignRole(siteAdmin, staff, "content_editor", com, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
  });

  it("does not let a site admin create a platform administrator", () => {
    expect(canAssignRole(siteAdmin, staff, "platform_super_admin", platform, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
  });

  it("does not let a role without role_assignment:grant grant anything", () => {
    const editor = snapshot([grant("content_editor", BV)]);
    expect(canAssignRole(editor, staff, "read_only", bv, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
  });

  it("refuses roles carrying permissions the grantor does not hold", () => {
    const overreach: RoleDef = {
      key: "overreach",
      name: "Overreach",
      description: "A site role that smuggles in platform permissions",
      audience: "STAFF",
      scopeType: "SITE",
      permissions: ["content:read", "module:manage", "site:manage"],
    };
    expect(
      canAssignRole(siteAdmin, staff, "overreach", bv, NOW, new Map([["overreach", overreach]])),
    ).toEqual({ allowed: false, reason: "escalation", missing: ["module:manage", "site:manage"] });
  });

  it("holds nothing through revoked grants or an inactive account", () => {
    const revoked = snapshot([grant("site_admin", BV, { revokedAt: new Date(NOW.getTime() - 1) })]);
    expect(heldPermissions(revoked, bv, NOW).size).toBe(0);
    const suspended = snapshot([grant("site_admin", BV)], { principal: { status: "SUSPENDED" } });
    expect(heldPermissions(suspended, bv, NOW).size).toBe(0);
  });

  it("refuses self-grants, even for the super admin", () => {
    const self: Assignee = { userId: "user-1", kind: "STAFF", status: "ACTIVE" };
    expect(canAssignRole(superAdmin, self, "site_admin", bv, NOW)).toEqual({
      allowed: false,
      reason: "self_grant",
    });
  });

  it("relies on the sign-in MFA, no extra step-up to grant (DP-076 revision)", () => {
    const noMfa = snapshot([grant("platform_super_admin", null)], {
      principal: { mfaVerified: false },
    });
    expect(canAssignRole(noMfa, staff, "content_editor", bv, NOW)).toEqual({ allowed: true });
  });

  it("matches audience and scope type of the role", () => {
    expect(canAssignRole(superAdmin, customer, "content_editor", bv, NOW)).toEqual({
      allowed: false,
      reason: "audience_mismatch",
    });
    expect(canAssignRole(superAdmin, staff, "member", bv, NOW)).toEqual({
      allowed: false,
      reason: "audience_mismatch",
    });
    expect(canAssignRole(superAdmin, staff, "site_admin", platform, NOW)).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
    expect(canAssignRole(superAdmin, staff, "platform_super_admin", bv, NOW)).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
  });

  it("lets the MFA-verified super admin create another platform administrator", () => {
    expect(canAssignRole(superAdmin, staff, "platform_super_admin", platform, NOW)).toEqual({
      allowed: true,
    });
  });

  it("refuses deactivated assignees and unknown roles", () => {
    expect(
      canAssignRole(superAdmin, { ...staff, status: "DEACTIVATED" }, "read_only", bv, NOW),
    ).toEqual({ allowed: false, reason: "assignee_inactive" });
    expect(canAssignRole(superAdmin, staff, "root", bv, NOW)).toEqual({
      allowed: false,
      reason: "unknown_role",
    });
  });
});

describe("publisher roles are managed, not held, by the super admin (F1-001B)", () => {
  it("lets the super admin hand out publisher roles and site admins without publishing itself", () => {
    expect(heldPermissions(superAdmin, bv, NOW).has("content:publish")).toBe(false);
    for (const role of ["content_publisher", "product_publisher", "site_admin"]) {
      expect(canAssignRole(superAdmin, staff, role, bv, NOW), role).toEqual({ allowed: true });
    }
  });

  it("allows the delegation only through publisher_role:grant", () => {
    // site_admin of BV holds publish on BV, not on COM, and has no publisher_role:grant.
    expect(canAssignRole(siteAdmin, staff, "content_publisher", com, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
    const sneaky: RoleDef = {
      key: "sneaky",
      name: "Sneaky",
      description: "",
      audience: "STAFF",
      scopeType: "SITE",
      permissions: ["content:publish", "module:manage"],
    };
    expect(
      canAssignRole(superAdmin, staff, "sneaky", bv, NOW, new Map([["sneaky", sneaky]])),
    ).toEqual({ allowed: false, reason: "escalation", missing: ["module:manage"] });
  });
});

describe("customer-data roles need dual approval, which does not exist yet (F1-001B)", () => {
  // DP-108: system_owner carries customer data too, but it is never assigned (tested below).
  const customerDataRoles = ROLES.filter((r) => isCustomerDataRole(r) && isAssignableRole(r));

  it("are exactly the roles carrying lead, membership or CRM permissions", () => {
    expect(customerDataRoles.map((r) => r.key).sort()).toEqual([
      "platform_customer_data_officer",
      "platform_super_admin",
      "sales_crm_user",
    ]);
  });

  it("are assigned directly by the super admin, never by a site admin (no escalation)", () => {
    for (const role of customerDataRoles) {
      const target = role.scopeType === "PLATFORM" ? platform : bv;
      expect(canAssignRole(superAdmin, staff, role.key, target, NOW), role.key).toEqual({
        allowed: true,
      });
      expect(canAssignRole(siteAdmin, staff, role.key, target, NOW), role.key).toMatchObject({
        allowed: false,
      });
    }
  });

  it("needs no step-up beyond the sign-in MFA", () => {
    const stale = snapshot([grant("platform_super_admin", null)], {
      principal: { mfaVerified: false },
    });
    expect(canAssignRole(stale, staff, "sales_crm_user", bv, NOW)).toEqual({ allowed: true });
    expect(canAssignRole(stale, staff, "site_admin", bv, NOW)).toEqual({ allowed: true });
  });

  it("leaves member assignment to self-registration (no staff holds membership:manage)", () => {
    expect(canAssignRole(siteAdmin, customer, "member", bv, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
  });
});

describe("reciprocal and indirect self-grants (F1-001B)", () => {
  it("refuses granting to anyone in the grantor's grant ancestry", () => {
    // user-2 granted user-1's roles (directly or through a chain): user-1 cannot grant back.
    const granted = snapshot([grant("platform_super_admin", null)], { ancestry: ["user-2"] });
    expect(canAssignRole(granted, staff, "content_editor", bv, NOW)).toEqual({
      allowed: false,
      reason: "reciprocal_grant",
    });
    expect(canAssignRole(granted, staff, "platform_super_admin", platform, NOW)).toEqual({
      allowed: false,
      reason: "reciprocal_grant",
    });
    const other: Assignee = { userId: "user-9", kind: "STAFF", status: "ACTIVE" };
    expect(canAssignRole(granted, other, "content_editor", bv, NOW)).toEqual({ allowed: true });
  });

  it("denies by default when the ancestry was not loaded", () => {
    const unknown = {
      ...snapshot([grant("platform_super_admin", null)]),
      grantAncestry: undefined,
    };
    expect(canAssignRole(unknown, staff, "content_editor", bv, NOW)).toEqual({
      allowed: false,
      reason: "ancestry_unknown",
    });
  });
});

describe("canRevokeRole", () => {
  it("needs role_assignment:revoke at the assignment's scope", () => {
    expect(canRevokeRole(siteAdmin, "content_editor", bv, NOW)).toEqual({ allowed: true });
    expect(canRevokeRole(siteAdmin, "content_editor", com, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
    expect(canRevokeRole(siteAdmin, "platform_super_admin", platform, NOW)).toEqual({
      allowed: false,
      reason: "not_allowed",
    });
  });

  it("lets the super admin revoke publisher roles on any site", () => {
    expect(canRevokeRole(superAdmin, "content_publisher", com, NOW)).toEqual({ allowed: true });
  });
});

describe("last platform administrator", () => {
  it("refuses to revoke the last platform administrator, including oneself", () => {
    expect(canRevokeRole(superAdmin, "platform_super_admin", platform, NOW, 0)).toEqual({
      allowed: false,
      reason: "last_platform_admin",
    });
    expect(canRevokeRole(superAdmin, "platform_super_admin", platform, NOW, 1)).toEqual({
      allowed: true,
    });
  });

  it("treats an unknown count as zero (deny by default)", () => {
    expect(canRevokeRole(superAdmin, "platform_super_admin", platform, NOW)).toEqual({
      allowed: false,
      reason: "last_platform_admin",
    });
    expect(platformAdminRemovalProblem(true, undefined)).toBe("last_platform_admin");
  });

  it("refuses an expiry on the last non-expiring platform administrator (F1-001B)", () => {
    expect(platformAdminExpiryProblem(true, 0)).toBe("last_platform_admin");
    expect(platformAdminExpiryProblem(true, undefined)).toBe("last_platform_admin");
    expect(platformAdminExpiryProblem(true, 1)).toBeNull();
    expect(platformAdminExpiryProblem(false, 0)).toBeNull();
  });

  it("does not restrict other roles or non-admins", () => {
    expect(canRevokeRole(superAdmin, "site_admin", bv, NOW)).toEqual({ allowed: true });
    expect(platformAdminRemovalProblem(false, 0)).toBeNull();
  });
});

describe("the system owner (DP-108, ADR-018)", () => {
  const owner = snapshot([SYSTEM_OWNER_GRANT], { owner: true });
  const ownerAssignee: Assignee = { ...staff, isSystemOwner: true };

  it("never assigns system_owner, whoever asks (condition 6)", () => {
    for (const grantor of [superAdmin, owner]) {
      expect(canAssignRole(grantor, staff, "system_owner", platform, NOW)).toEqual({
        allowed: false,
        reason: "not_assignable",
      });
    }
  });

  it("gives the owner no role from anyone (condition 7)", () => {
    expect(canAssignRole(superAdmin, ownerAssignee, "site_admin", bv, NOW)).toEqual({
      allowed: false,
      reason: "owner_target",
    });
    expect(canAssignRole(superAdmin, ownerAssignee, "platform_super_admin", platform, NOW)).toEqual(
      { allowed: false, reason: "owner_target" },
    );
  });

  it("lets the owner assign every assignable role, the super admin included", () => {
    for (const role of ROLES.filter((r) => r.audience === "STAFF" && isAssignableRole(r))) {
      const target = role.scopeType === "PLATFORM" ? platform : bv;
      expect(canAssignRole(owner, staff, role.key, target, NOW), role.key).toEqual({
        allowed: true,
      });
    }
  });

  it("keeps the super admin from handing out God Mode permissions (no escalation)", () => {
    const held = heldPermissions(superAdmin, platform, NOW);
    expect(held.has("module:manage")).toBe(false);
    expect(held.has("owner_audit:read")).toBe(false);
  });
});
