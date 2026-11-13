import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MODULES,
  PERMISSIONS,
  PUBLISH_PERMISSIONS,
  RETIRED_PERMISSIONS,
  ROLES,
  catalogProblems,
  type RoleDef,
} from "../../../src/iam/catalog.js";
import { normalizeMarkdown, renderPermissionMatrix } from "../../../src/iam/matrix.js";
import { moduleChangeProblem } from "../../../src/iam/modules.js";
import { SESSION_POLICIES, mayOpenSession } from "../../../src/iam/session-policy.js";

describe("catalogue consistency", () => {
  it("has no problems", () => {
    expect(catalogProblems()).toEqual([]);
  });

  it("marks MFA, audit and RBAC as core modules", () => {
    for (const key of ["rbac", "audit", "mfa"]) {
      expect(MODULES.find((m) => m.key === key)?.isCore).toBe(true);
    }
  });

  it("gives the platform super admin every staff permission except publishing and God Mode (DP-076 revision, DP-108)", () => {
    const admin = ROLES.find((r) => r.key === "platform_super_admin");
    const expected = PERMISSIONS.filter(
      (p) => p.audience === "STAFF" && !PUBLISH_PERMISSIONS.includes(p.key) && !p.ownerOnly,
    ).map((p) => p.key);
    expect(admin?.permissions).not.toContain("module:manage");
    expect(admin?.permissions).not.toContain("owner_audit:read");
    expect(admin?.permissions).toContain("module:read");
    expect([...(admin?.permissions ?? [])].sort()).toEqual([...expected].sort());
    expect(admin?.customerDataAccess).toBe(true);
    expect(admin?.permissions).toContain("lead:read");
  });

  it("defines system_owner as the only non-assignable role and the only holder of owner-only permissions (DP-108)", () => {
    const owner = ROLES.find((r) => r.key === "system_owner");
    expect(owner?.assignable).toBe(false);
    expect(owner?.scopeType).toBe("PLATFORM");
    expect(ROLES.filter((r) => r.assignable === false).map((r) => r.key)).toEqual(["system_owner"]);
    const ownerOnly = PERMISSIONS.filter((p) => p.ownerOnly).map((p) => p.key);
    expect(ownerOnly.sort()).toEqual(["module:manage", "owner_audit:read"]);
    for (const r of ROLES) {
      if (r.key === "system_owner") continue;
      for (const key of ownerOnly) expect(r.permissions, `${r.key} ${key}`).not.toContain(key);
    }
    const staffKeys = PERMISSIONS.filter(
      (p) => p.audience === "STAFF" && !RETIRED_PERMISSIONS.includes(p.key),
    ).map((p) => p.key);
    expect([...(owner?.permissions ?? [])].sort()).toEqual([...staffKeys].sort());
  });

  it("finds a second non-assignable role or an owner-only permission elsewhere (DP-108)", () => {
    const extra = { ...ROLES.find((r) => r.key === "site_admin")!, key: "x", assignable: false };
    expect(
      catalogProblems({ modules: MODULES, permissions: PERMISSIONS, roles: [...ROLES, extra] }),
    ).toContain("role system_owner: must be the only non-assignable role");
    const leaky = ROLES.map((r) =>
      r.key === "platform_super_admin"
        ? { ...r, permissions: [...r.permissions, "module:manage"] }
        : r,
    );
    expect(catalogProblems({ modules: MODULES, permissions: PERMISSIONS, roles: leaky })).toContain(
      "role platform_super_admin: carries owner-only permission module:manage",
    );
  });

  it("needs no extra step-up for role changes (sign-in MFA only, DP-076 revision)", () => {
    for (const key of ["role_assignment:grant", "role_assignment:revoke"]) {
      expect(PERMISSIONS.find((p) => p.key === key)?.sensitive, key).toBe(false);
    }
    // Account recovery and closure keep their step-up.
    for (const key of ["mfa:reset", "user:suspend", "user:deactivate", "session:revoke"]) {
      expect(PERMISSIONS.find((p) => p.key === key)?.sensitive, key).toBe(true);
    }
  });

  it("allows platform-wide customer data only in roles marked customerDataAccess", () => {
    for (const r of ROLES.filter((x) => x.scopeType === "PLATFORM")) {
      const data = r.permissions.filter((k) => PERMISSIONS.find((p) => p.key === k)?.customerData);
      if (data.length) expect(r.customerDataAccess, r.key).toBe(true);
    }
    expect(ROLES.filter((r) => r.customerDataAccess).map((r) => r.key)).toEqual([
      "system_owner",
      "platform_super_admin",
      "platform_customer_data_officer",
    ]);
  });

  it("gives publish permissions only to publishers and site admins, never the super admin", () => {
    for (const key of ["content:publish", "product:publish"]) {
      expect(
        ROLES.filter((r) => r.permissions.includes(key))
          .map((r) => r.key)
          .sort(),
      ).toEqual(
        [
          "site_admin",
          // DP-108 (K4): the never-assigned system owner publishes too.
          "system_owner",
          key === "content:publish" ? "content_publisher" : "product_publisher",
        ].sort(),
      );
      expect(PERMISSIONS.find((p) => p.key === key)?.delegableVia).toBe("publisher_role:grant");
    }
    for (const editor of ["content_editor", "product_editor"]) {
      const perms = ROLES.find((r) => r.key === editor)?.permissions ?? [];
      expect(perms.filter((p) => p.endsWith(":publish") || p.endsWith(":approve"))).toEqual([]);
    }
  });

  it("keeps platform permissions out of site roles", () => {
    const platformPerms = new Set(
      PERMISSIONS.filter((p) => p.scopeType === "PLATFORM").map((p) => p.key),
    );
    for (const r of ROLES.filter((x) => x.scopeType === "SITE")) {
      expect(r.permissions.filter((p) => platformPerms.has(p))).toEqual([]);
    }
  });

  it("separates entry, approval and publication of products (K-01)", () => {
    const pm = ROLES.find((r) => r.key === "product_editor")?.permissions ?? [];
    expect(pm).toContain("product:edit");
    expect(pm).not.toContain("product:approve");
    expect(pm).not.toContain("product:publish");
  });

  it("detects broken catalogues", () => {
    const bad: RoleDef = {
      key: "bad_role",
      name: "Bad",
      description: "",
      audience: "STAFF",
      scopeType: "SITE",
      permissions: ["module:manage", "nope:nope", "technical_spec:view"],
    };
    const leaky: RoleDef = {
      key: "leaky_platform",
      name: "Leaky",
      description: "",
      audience: "STAFF",
      scopeType: "PLATFORM",
      permissions: ["lead:read"],
    };
    expect(
      catalogProblems({ modules: MODULES, permissions: PERMISSIONS, roles: [leaky] }),
    ).toContain(
      "role leaky_platform: platform role carries customer data lead:read without customerDataAccess",
    );
    const problems = catalogProblems({
      modules: MODULES.filter((m) => m.key !== "mfa"),
      permissions: PERMISSIONS,
      roles: [bad],
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        "module mfa: must exist and be core",
        "role bad_role: platform permission module:manage in a site role",
        "role bad_role: unknown permission nope:nope",
        "role bad_role: technical_spec:view is for CUSTOMER",
      ]),
    );
  });
});

describe("database guard matches the catalogue (F1-001B)", () => {
  it("lists the customer-data resources of the catalogue in iam_customer_data_resources()", () => {
    const sql = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../prisma/migrations/20261110210000_f1_001b_rbac_guards/migration.sql",
      ),
      "utf8",
    );
    const m = /iam_customer_data_resources\(\)[\s\S]*?ARRAY\[([^\]]*)\]/.exec(sql);
    const inSql = (m?.[1] ?? "")
      .split(",")
      .map((x) => x.trim().replace(/'/g, ""))
      .sort();
    const inCatalog = [
      ...new Set(PERMISSIONS.filter((p) => p.customerData).map((p) => p.resource)),
    ].sort();
    expect(inSql).toEqual(inCatalog);
    // Every permission of those resources is flagged, so the database cannot under-match.
    for (const p of PERMISSIONS.filter((x) => inCatalog.includes(x.resource))) {
      expect(p.customerData, p.key).toBe(true);
    }
  });
});

describe("God Mode module changes", () => {
  it("can never disable a core module", () => {
    for (const key of ["mfa", "audit", "rbac", "cms"]) {
      expect(moduleChangeProblem({ moduleKey: key, enabled: false, reason: "test" })).toBe(
        "core_module",
      );
    }
  });

  it("toggles optional modules with a reason", () => {
    expect(moduleChangeProblem({ moduleKey: "crm", enabled: true, reason: "pilot" })).toBeNull();
    expect(
      moduleChangeProblem({ moduleKey: "crm", enabled: false, reason: "end of pilot" }),
    ).toBeNull();
    expect(moduleChangeProblem({ moduleKey: "crm", enabled: false, reason: "  " })).toBe(
      "reason_required",
    );
    expect(moduleChangeProblem({ moduleKey: "nope", enabled: true, reason: "x" })).toBe(
      "unknown_module",
    );
  });
});

describe("session policies", () => {
  it("is stricter for staff than for customers", () => {
    const { STAFF: staff, CUSTOMER: customer } = SESSION_POLICIES;
    expect(staff.mfa).toBe("required");
    expect(staff.persistent).toBe(false);
    expect(staff.stepUpMaxAgeMinutes).not.toBeNull();
    expect(staff.idleTimeoutMinutes).toBeLessThan(customer.idleTimeoutMinutes);
    expect(staff.absoluteTimeoutMinutes).toBeLessThan(customer.absoluteTimeoutMinutes);
    expect(staff.maxConcurrentSessions).toBeLessThan(customer.maxConcurrentSessions);
    expect(staff.cookieName).not.toBe(customer.cookieName);
    for (const p of [staff, customer]) expect(p.cookieName.startsWith("__Host-")).toBe(true);
  });

  it("never opens a public-site session for staff or an admin session for customers", () => {
    expect(mayOpenSession("STAFF", "admin")).toBe(true);
    expect(mayOpenSession("STAFF", "web-bv")).toBe(false);
    expect(mayOpenSession("CUSTOMER", "admin")).toBe(false);
    expect(mayOpenSession("CUSTOMER", "web-corporate")).toBe(true);
  });
});

describe("permission matrix document", () => {
  it("docs/security/rbac-matrix.md matches the catalogue", () => {
    const doc = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../docs/security/rbac-matrix.md",
    );
    expect(normalizeMarkdown(readFileSync(doc, "utf8"))).toBe(
      normalizeMarkdown(renderPermissionMatrix()),
    );
  });
});
