/**
 * DP-288 (ADR-030 D3–D7) without a database: roles and permissions of the AI Center, the
 * owner-managed role rule, the AI environment, audit metadata, the key keyring, and schema rules
 * (no prompt/response text column, integer money). The database side (tables, RLS, triggers) is in
 * test/integration/owner.int.test.ts (DP-288 block) and db-roles.int.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decide } from "../../../src/iam/authorization.js";
import {
  AI_MANAGE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_BY_KEY,
  catalogProblems,
  MODULES,
} from "../../../src/iam/catalog.js";
import { canAssignRole, canRevokeRole } from "../../../src/iam/escalation.js";
import { SYSTEM_OWNER_GRANT } from "../../../src/iam/repository.js";
import {
  aiCredentialAad,
  decryptSecret,
  encryptSecret,
  parseKeyring,
} from "../../../src/iam/auth/secret-box.js";
import {
  AiConfigError,
  LOCAL_CAP_DAILY_MICROS,
  LOCAL_CAP_MONTHLY_MICROS,
  effectiveLimitMicros,
  loadAiConfig,
  parseUsd,
} from "../../../src/ai/config/ai-config.js";
import { AI_AUDIT_ACTIONS, aiAuditMetadata } from "../../../src/ai/audit.js";
import { NOW, grant, snapshot } from "../iam/fixtures.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(path.resolve(DIR, "../../../prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  path.resolve(DIR, "../../../prisma/migrations/20261217090000_dp_288_ai_data_model/migration.sql"),
  "utf8",
);
const platform = { scope: "platform" } as const;
const key32 = () => randomBytes(32).toString("base64url");

describe("DP-288: AI roles and permissions", () => {
  const admin = ROLE_BY_KEY.get("ai_administrator")!;
  const viewer = ROLE_BY_KEY.get("ai_viewer")!;

  it("defines ai_administrator (owner-managed) and ai_viewer (read-only) as platform staff roles", () => {
    expect(admin).toMatchObject({ audience: "STAFF", scopeType: "PLATFORM", ownerManaged: true });
    expect([...admin.permissions].sort()).toEqual(
      ["ai:read", "ai_usage:read", ...AI_MANAGE_PERMISSIONS].sort(),
    );
    expect(viewer).toMatchObject({ audience: "STAFF", scopeType: "PLATFORM" });
    expect(viewer.ownerManaged).toBeUndefined();
    expect([...viewer.permissions].sort()).toEqual(["ai:read", "ai_usage:read"]);
    for (const p of AI_MANAGE_PERMISSIONS) {
      // DP-290: ai:invoke (starting operations) is not a step-up permission; the others are.
      expect(PERMISSIONS.find((x) => x.key === p)).toMatchObject({
        module: "ai",
        scopeType: "PLATFORM",
        sensitive: p !== "ai:invoke",
      });
    }
    expect(catalogProblems()).toEqual([]);
  });

  it("never gives the global switch to an AI role; AI management stays with the owner's role", () => {
    for (const r of [admin, viewer]) {
      expect(r.permissions).not.toContain("module:manage");
      expect(r.permissions).not.toContain("owner_audit:read");
    }
    const holders = ROLES.filter((r) =>
      AI_MANAGE_PERMISSIONS.some((p) => r.permissions.includes(p)),
    )
      .map((r) => r.key)
      .sort();
    expect(holders).toEqual(["ai_administrator", "system_owner"]);
    const superAdmin = ROLE_BY_KEY.get("platform_super_admin")!;
    expect(superAdmin.permissions).toContain("ai:read");
    expect(superAdmin.permissions).toContain("ai_usage:read");
    for (const p of AI_MANAGE_PERMISSIONS) expect(superAdmin.permissions).not.toContain(p);
    // The catalogue refuses a role that would leak AI management.
    const leaky = ROLES.map((r) =>
      r.key === "platform_super_admin"
        ? { ...r, permissions: [...r.permissions, "ai_budget:manage"] }
        : r,
    );
    expect(catalogProblems({ modules: MODULES, permissions: PERMISSIONS, roles: leaky })).toContain(
      "role platform_super_admin: carries AI management permission ai_budget:manage (owner-managed roles only)",
    );
  });

  it("lists the same owner-managed roles in the database guard as in the catalogue", () => {
    const m = /iam_owner_managed_role_keys\(\)[\s\S]*?SELECT ARRAY\[([^\]]*)\]::text\[\]/.exec(
      MIGRATION,
    );
    const fromSql = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(fromSql.sort()).toEqual(
      ROLES.filter((r) => r.ownerManaged)
        .map((r) => r.key)
        .sort(),
    );
  });

  it("lets only the system owner assign or revoke ai_administrator; ai_viewer the super admin too", () => {
    const owner = snapshot([SYSTEM_OWNER_GRANT], { owner: true, ancestry: [] });
    const superAdmin = snapshot([grant("platform_super_admin", null)], { ancestry: [] });
    // A super admin who holds ai_administrator itself still may not pass it on.
    const aiSuper = snapshot(
      [grant("platform_super_admin", null), grant("ai_administrator", null)],
      {
        ancestry: [],
        platformModules: ["ai"],
      },
    );
    const assignee = { userId: "user-2", kind: "STAFF" as const, status: "ACTIVE" as const };
    expect(canAssignRole(owner, assignee, "ai_administrator", platform, NOW)).toEqual({
      allowed: true,
    });
    for (const g of [superAdmin, aiSuper]) {
      expect(canAssignRole(g, assignee, "ai_administrator", platform, NOW)).toEqual({
        allowed: false,
        reason: "not_allowed",
      });
      expect(canRevokeRole(g, "ai_administrator", platform, NOW)).toEqual({
        allowed: false,
        reason: "not_allowed",
      });
      expect(canAssignRole(g, assignee, "ai_viewer", platform, NOW)).toEqual({ allowed: true });
    }
    expect(canRevokeRole(owner, "ai_administrator", platform, NOW)).toEqual({ allowed: true });
  });

  it("closes every AI permission while AI is off, and asks for a step-up for management", () => {
    const off = snapshot([grant("ai_administrator", null)]);
    const on = snapshot([grant("ai_administrator", null)], { platformModules: ["ai"] });
    const stale = snapshot([grant("ai_administrator", null)], {
      platformModules: ["ai"],
      principal: { mfaVerified: false },
    });
    for (const p of ["ai:read", "ai_usage:read", ...AI_MANAGE_PERMISSIONS]) {
      expect(decide(off, p, platform, NOW)).toEqual({ allowed: false, reason: "module_disabled" });
      expect(decide(on, p, platform, NOW).allowed, p).toBe(true);
    }
    for (const p of AI_MANAGE_PERMISSIONS.filter((x) => x !== "ai:invoke")) {
      expect(decide(stale, p, platform, NOW)).toEqual({ allowed: false, reason: "mfa_required" });
    }
    expect(decide(stale, "ai:invoke", platform, NOW).allowed).toBe(true);
    expect(decide(on, "module:manage", platform, NOW)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
    const viewer = snapshot([grant("ai_viewer", null)], { platformModules: ["ai"] });
    expect(decide(viewer, "ai_usage:read", platform, NOW).allowed).toBe(true);
    for (const p of AI_MANAGE_PERMISSIONS) {
      expect(decide(viewer, p, platform, NOW)).toEqual({ allowed: false, reason: "no_grant" });
    }
  });
});

describe("DP-288: the AI environment (ai-config)", () => {
  const iam = { IAM_MFA_ENC_KEYS: `1:${key32()}`, IAM_HMAC_KEY: key32() };

  it("is off by default and needs nothing else then", () => {
    expect(loadAiConfig({}, "local")).toEqual({ transport: "off", keyring: null, localCap: null });
    expect(loadAiConfig({ DP_AI_TRANSPORT: " " }, "production").transport).toBe("off");
    expect(() => loadAiConfig({ DP_AI_TRANSPORT: "on" }, "local")).toThrow(AiConfigError);
  });

  it("needs its own keyring for fake and live, distinct from the IAM keys", () => {
    expect(() => loadAiConfig({ DP_AI_TRANSPORT: "fake" }, "local")).toThrow(
      /DP_AI_ENC_KEYS is not set/,
    );
    const fake = loadAiConfig(
      { ...iam, DP_AI_TRANSPORT: "fake", DP_AI_ENC_KEYS: `1:${key32()}` },
      "staging",
    );
    expect(fake.transport).toBe("fake");
    expect(fake.localCap).toBeNull();
    const reused = iam.IAM_MFA_ENC_KEYS.split(":")[1];
    expect(() =>
      loadAiConfig({ ...iam, DP_AI_TRANSPORT: "fake", DP_AI_ENC_KEYS: `1:${reused}` }, "local"),
    ).toThrow(/must differ from every IAM key/);
    expect(() =>
      loadAiConfig(
        { ...iam, DP_AI_TRANSPORT: "fake", DP_AI_ENC_KEYS: `1:${iam.IAM_HMAC_KEY}` },
        "local",
      ),
    ).toThrow(/must differ from every IAM key/);
  });

  it("allows live only locally, only explicitly, and caps it at USD 1/day and 5/month", () => {
    const base = { ...iam, DP_AI_TRANSPORT: "live", DP_AI_ENC_KEYS: `1:${key32()}` };
    expect(() => loadAiConfig(base, "local")).toThrow(/DP_AI_ALLOW_LIVE_LOCAL=true/);
    for (const env of ["staging", "production"] as const) {
      expect(() => loadAiConfig({ ...base, DP_AI_ALLOW_LIVE_LOCAL: "true" }, env)).toThrow(/DPO/);
    }
    const live = loadAiConfig({ ...base, DP_AI_ALLOW_LIVE_LOCAL: "true" }, "local");
    expect(live.localCap).toEqual({
      dailyMicros: LOCAL_CAP_DAILY_MICROS,
      monthlyMicros: LOCAL_CAP_MONTHLY_MICROS,
    });
    expect(LOCAL_CAP_DAILY_MICROS).toBe(1_000_000n);
    expect(LOCAL_CAP_MONTHLY_MICROS).toBe(5_000_000n);
    const lower = loadAiConfig(
      {
        ...base,
        DP_AI_ALLOW_LIVE_LOCAL: "true",
        DP_AI_LOCAL_CAP_DAILY_USD: "0.25",
        DP_AI_LOCAL_CAP_MONTHLY_USD: "2",
      },
      "local",
    );
    expect(lower.localCap).toEqual({ dailyMicros: 250_000n, monthlyMicros: 2_000_000n });
    for (const [k, v] of [
      ["DP_AI_LOCAL_CAP_DAILY_USD", "1.01"],
      ["DP_AI_LOCAL_CAP_MONTHLY_USD", "6"],
    ] as const) {
      expect(() =>
        loadAiConfig({ ...base, DP_AI_ALLOW_LIVE_LOCAL: "true", [k]: v }, "local"),
      ).toThrow(/only lower/);
    }
    expect(effectiveLimitMicros(live, "DAILY", 50_000_000n)).toBe(1_000_000n);
    expect(effectiveLimitMicros(live, "MONTHLY", 3_000_000n)).toBe(3_000_000n);
    expect(effectiveLimitMicros(loadAiConfig({}, "local"), "DAILY", 50_000_000n)).toBe(50_000_000n);
  });

  it("parses USD amounts into micro-USD exactly", () => {
    expect(parseUsd("0.5", "X")).toBe(500_000n);
    expect(parseUsd("1.000001", "X")).toBe(1_000_001n);
    expect(() => parseUsd("-1", "X")).toThrow();
    expect(() => parseUsd("1.0000001", "X")).toThrow();
  });
});

describe("DP-288: keys and audit metadata", () => {
  it("encrypts a provider key bound to its row and provider, with its own keyring", () => {
    const ring = parseKeyring(`1:${key32()}`, "DP_AI_ENC_KEYS");
    const aad = aiCredentialAad("cred-1", "OPENAI");
    const stored = encryptSecret(ring, Buffer.from("sk-test-not-a-real-key"), aad);
    expect(stored).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain("sk-test");
    expect(decryptSecret(ring, stored, aad).toString()).toBe("sk-test-not-a-real-key");
    expect(() => decryptSecret(ring, stored, aiCredentialAad("cred-1", "GEMINI"))).toThrow();
    expect(() => decryptSecret(ring, stored, aiCredentialAad("cred-2", "OPENAI"))).toThrow();
    expect(() => parseKeyring(undefined, "DP_AI_ENC_KEYS")).toThrow(/^DP_AI_ENC_KEYS is not set$/);
  });

  it("keeps AI audit metadata to ids, codes and amounts", () => {
    for (const a of AI_AUDIT_ACTIONS) expect(a).toMatch(/^ai(\.[a-z][a-z_]*)+$/);
    expect(
      aiAuditMetadata({
        provider: "OPENAI",
        keyHint: "sk-…ab12",
        reservedMicros: 1500n,
        apiKey: "sk-live-secret",
        prompt: "translate this",
        response: "…",
        code: "x".repeat(500),
        nested: { a: 1 },
      }),
    ).toEqual({ provider: "OPENAI", keyHint: "sk-…ab12", reservedMicros: "1500" });
  });
});

describe("DP-288: schema rules", () => {
  const models = [...SCHEMA.matchAll(/^model (Ai\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1]!,
    body: m[2]!,
  }));
  const fields = (body: string) =>
    body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z]\w*\s+\w/.test(l))
      .map((l) => {
        const [name, type] = l.split(/\s+/);
        return { name: name!, type: type! };
      });

  it("has the eleven AI tables", () => {
    expect(models.map((m) => m.name).sort()).toEqual(
      [
        "AiBudget",
        "AiBudgetUsage",
        "AiLedgerEntry",
        "AiModel",
        "AiModelPrice",
        "AiOperation",
        "AiProviderCredential",
        "AiProviderSetting",
        "AiReconciliation",
        "AiSettings",
        "AiTaskSetting",
      ].sort(),
    );
    expect(SCHEMA).toMatch(/enum AiProvider \{\s+OPENAI\s+ANTHROPIC\s+GEMINI\s+\}/);
  });

  it("stores no prompt, response or other content text (owner decision 11)", () => {
    for (const m of models) {
      for (const f of fields(m.body)) {
        // The key's encrypted form (secret-box) is the one allowed "text".
        if (m.name === "AiProviderCredential" && f.name === "ciphertext") continue;
        // Whole camel-case words: "contextWindow" is a token count, not a text.
        const words = f.name.split(/(?=[A-Z])/).map((w) => w.toLowerCase());
        const banned = ["prompt", "response", "content", "message", "text", "body", "completion"];
        expect(
          words.filter((w) => banned.includes(w)),
          `${m.name}.${f.name}`,
        ).toEqual([]);
        expect(["input", "output", "key", "apiKey", "secret"]).not.toContain(f.name);
      }
    }
  });

  it("keeps money in integer micro-USD", () => {
    for (const m of models) {
      for (const f of fields(m.body)) {
        if (/Micros/.test(f.name)) expect(f.type, `${m.name}.${f.name}`).toMatch(/^BigInt\??$/);
        expect(f.type, `${m.name}.${f.name}`).not.toMatch(/^(Float|Decimal)/);
      }
    }
  });

  it("enables row-level security on every AI table and never grants DELETE", () => {
    for (const m of models) {
      expect(MIGRATION, m.name).toContain(`ALTER TABLE "${m.name}" ENABLE ROW LEVEL SECURITY;`);
    }
    expect(MIGRATION).toMatch(
      /REVOKE DELETE ON TABLE "AiSettings"[\s\S]*"AiReconciliation" FROM dp_app;/,
    );
  });
});
