/**
 * DP-287 (ADR-030 D1, D2): the platform-wide AI switch in the catalogue and in `decide`. The
 * database side (row-level security, triggers, the FOR SHARE hold, the switch-off race) is tested
 * in test/integration/owner.int.test.ts (DP-287 block).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide } from "../../../src/iam/authorization.js";
import {
  MODULES,
  MODULE_BY_KEY,
  PERMISSIONS,
  ROLES,
  SYSTEM_OWNER,
  catalogProblems,
} from "../../../src/iam/catalog.js";
import { moduleChangeProblem } from "../../../src/iam/modules.js";
import { SYSTEM_OWNER_GRANT } from "../../../src/iam/repository.js";
import { BV, NOW, grant, snapshot } from "./fixtures.js";

const platform = { scope: "platform" } as const;
const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../prisma/migrations/20261216090000_dp_287_platform_module_gate/migration.sql",
);

describe("DP-287: the AI Center in the catalogue", () => {
  it("is an optional, platform-switched module with a platform read permission", () => {
    const ai = MODULE_BY_KEY.get("ai");
    expect(ai).toMatchObject({ key: "ai", isCore: false, scope: "PLATFORM" });
    expect(MODULES.filter((m) => m.scope === "PLATFORM").map((m) => m.key)).toEqual(["ai"]);
    // DP-288 adds usage reading and the three management permissions.
    expect(PERMISSIONS.filter((p) => p.module === "ai").map((p) => p.key)).toEqual([
      "ai:read",
      "ai_usage:read",
      "ai_provider:manage",
      "ai_model:manage",
      "ai_budget:manage",
    ]);
    expect(PERMISSIONS.find((p) => p.key === "ai:read")).toMatchObject({
      scopeType: "PLATFORM",
      sensitive: false,
    });
  });

  it("keeps the global switch (module:manage) with the system owner alone", () => {
    const holders = ROLES.filter((r) => r.permissions.includes("module:manage")).map((r) => r.key);
    expect(holders).toEqual([SYSTEM_OWNER]);
    expect(ROLES.find((r) => r.key === SYSTEM_OWNER)?.assignable).toBe(false);
    expect(PERMISSIONS.find((p) => p.key === "module:manage")).toMatchObject({
      ownerOnly: true,
      sensitive: true,
      scopeType: "PLATFORM",
    });
  });

  it("lists the same owner-only permissions in the database guard as in the catalogue", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const m = /SELECT ARRAY\[([^\]]*)\]::text\[\]/.exec(sql);
    const fromSql = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    const fromCatalog = PERMISSIONS.filter((p) => p.ownerOnly).map((p) => p.key);
    expect(fromSql.sort()).toEqual(fromCatalog.sort());
  });

  it("refuses a core module with a platform-wide switch", () => {
    const modules = MODULES.map((m) =>
      m.key === "cms" ? { ...m, scope: "PLATFORM" as const } : m,
    );
    expect(catalogProblems({ modules, permissions: PERMISSIONS, roles: ROLES })).toContain(
      "module cms: platform-switched modules are optional",
    );
    expect(catalogProblems()).toEqual([]);
  });

  it("refuses a site switch of a platform module and a platform switch of a site module", () => {
    const change = (moduleKey: string) => ({ moduleKey, enabled: true, reason: "test reason" });
    expect(moduleChangeProblem(change("ai"), "SITE")).toBe("scope_mismatch");
    expect(moduleChangeProblem(change("ai"), "PLATFORM")).toBeNull();
    expect(moduleChangeProblem(change("crm"), "PLATFORM")).toBe("scope_mismatch");
    expect(moduleChangeProblem(change("crm"), "SITE")).toBeNull();
    expect(moduleChangeProblem({ ...change("ai"), reason: "  " }, "PLATFORM")).toBe(
      "reason_required",
    );
  });
});

describe("DP-287: decide while AI is off (default) and on", () => {
  const owner = (platformModules?: string[]) =>
    snapshot([SYSTEM_OWNER_GRANT], {
      owner: true,
      ...(platformModules ? { platformModules } : {}),
    });
  const superAdmin = (platformModules?: string[]) =>
    snapshot([grant("platform_super_admin", null)], platformModules ? { platformModules } : {});

  it("refuses ai:read to everyone, the owner included, while AI is off or unknown", () => {
    for (const s of [owner(), owner([]), superAdmin(), superAdmin([])]) {
      expect(decide(s, "ai:read", platform, NOW)).toEqual({
        allowed: false,
        reason: "module_disabled",
      });
    }
  });

  it("allows ai:read to the owner and the super admin while AI is on; site roles never", () => {
    expect(decide(owner(["ai"]), "ai:read", platform, NOW).allowed).toBe(true);
    expect(decide(superAdmin(["ai"]), "ai:read", platform, NOW).allowed).toBe(true);
    const siteAdmin = snapshot([grant("site_admin", BV)], { platformModules: ["ai"] });
    expect(decide(siteAdmin, "ai:read", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
  });

  it("keeps the switch itself usable for the owner while AI is off, and closed for the super admin", () => {
    expect(decide(owner(), "module:manage", platform, NOW).allowed).toBe(true);
    expect(decide(superAdmin(["ai"]), "module:manage", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
  });

  it("changes nothing for the other modules", () => {
    const off = superAdmin();
    const on = superAdmin(["ai"]);
    for (const p of PERMISSIONS.filter((x) => x.audience === "STAFF" && x.module !== "ai")) {
      const target =
        p.scopeType === "PLATFORM" ? platform : ({ scope: "site", siteId: BV } as const);
      expect(decide(off, p.key, target, NOW), p.key).toEqual(decide(on, p.key, target, NOW));
    }
  });
});
