/**
 * DP-307 (ADR-031 D6, ADR-030 D10) without a database: the personal-data gate requires provider
 * terms with every transport (the fake one included), the contracts know the new refusal, the
 * audit may name the terms record, and migration 50 follows migration 49 with the reviewed shape
 * (lock order, no destructive statement, grants). The database side is in
 * test/integration/owner.int.test.ts (DP-307 block) and db-roles.int.test.ts; the worker in
 * dp297-runner.test.ts (DP-307 cases).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AI_PERSONAL_DATA_REFUSALS } from "@dream/contracts";
import {
  personalDataRefusal,
  type AiTaskDataPolicy,
} from "../../../src/ai/engine/personal-data-gate.js";
import { AI_AUDIT_ACTIONS, aiAuditMetadata } from "../../../src/ai/audit.js";
import {
  DISPATCH_HANDOFF_MS,
  DISPATCH_START_DEADLINE_MS,
} from "../../../src/ai/runner/runner.service.js";
import { TERMS_LOCK_TIMEOUT_MS } from "../../../src/ai/data-terms.service.js";
import {
  WHILE_ENABLED_LOCK_TIMEOUT_MS,
  WHILE_ENABLED_TIMEOUT_MS,
} from "../../../src/iam/platform-modules.js";

// Today no purpose is approved for AI; the gate's later checks are reached with one approved.
vi.mock("@dream/contracts", async (orig) => {
  const real = await orig<typeof import("@dream/contracts")>();
  return { ...real, aiPurposeReady: () => true };
});

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(DIR, "../../../prisma/migrations");
const M49 = "20261222090000_dp_298_legal_texts_consents";
const M50 = "20261223090000_dp_307_dispatch_terms_recheck";
const SQL = readFileSync(path.join(MIGRATIONS, M50, "migration.sql"), "utf8");
const SCHEMA = readFileSync(path.resolve(DIR, "../../../prisma/schema.prisma"), "utf8");
/** A function's body in migration 50 (CREATE [OR REPLACE] FUNCTION name( … $fn$;). */
const body = (name: string) => {
  const m = new RegExp(`FUNCTION ${name}\\([\\s\\S]*?\\$fn\\$;`).exec(SQL);
  if (!m) throw new Error(`no ${name}`);
  return m[0];
};

describe("DP-307: the personal-data gate requires provider terms with every transport", () => {
  const crm: AiTaskDataPolicy = {
    kind: "personal_data",
    purposes: ["crm_record"],
    fields: { company: "company", enquiry: "enquiry" },
    permission: "lead:read",
    maxFieldChars: 500,
  };
  const facts = { hasPermission: true, providerTermsRecorded: true };

  it("refuses the fake transport without terms (no more fake shortcut)", () => {
    expect(personalDataRefusal(crm, { ...facts, transport: "fake" })).toBeNull();
    expect(
      personalDataRefusal(crm, { ...facts, transport: "fake", providerTermsRecorded: false }),
    ).toBe("provider_terms_missing");
    expect(
      personalDataRefusal(crm, { ...facts, transport: "live", providerTermsRecorded: false }),
    ).toBe("provider_terms_missing");
    expect(personalDataRefusal(crm, { ...facts, transport: "off" })).toBe("transport_not_allowed");
    expect(personalDataRefusal(crm, { ...facts, transport: "fake", hasPermission: false })).toBe(
      "permission_missing",
    );
    // A task without personal data never needs terms.
    expect(
      personalDataRefusal(
        { kind: "none" },
        { ...facts, transport: "fake", providerTermsRecorded: false },
      ),
    ).toBeNull();
  });

  it("knows the new refusal and audits the terms record (an id, never a text)", () => {
    expect(AI_PERSONAL_DATA_REFUSALS).toContain("provider_terms_revoked");
    expect(AI_AUDIT_ACTIONS).toContain("ai.operation.refused");
    const id = "0190c0de-0000-7000-8000-000000000307";
    expect(aiAuditMetadata({ dataTermsId: id, personalData: true, input: "x" })).toEqual({
      dataTermsId: id,
      personalData: true,
    });
  });
});

describe("DP-307: migration 50", () => {
  it("follows migration 49 directly and checks it is applied first", () => {
    const names = readdirSync(MIGRATIONS)
      .filter((n) => /^\d{14}_/.test(n))
      .sort();
    expect(names.indexOf(M50)).toBe(names.indexOf(M49) + 1);
    expect(names.at(-1)).toBe(M50);
    expect(SQL).toMatch(/RAISE EXCEPTION 'DP-307: migrations [^']*dp_298_legal_texts_consents/);
  });

  it("has no destructive statement (columns are added, functions replaced)", () => {
    // The patterns of tools/migrations/check-migrations.mjs (ADR-010), comments stripped.
    const code = SQL.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    expect(code).not.toMatch(
      /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|TYPE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRENAME\s+(TO|COLUMN)\b|\bALTER\s+COLUMN\b/i,
    );
    expect(SQL).toMatch(/ADD COLUMN "personalData" BOOLEAN NOT NULL DEFAULT false/);
    expect(SQL).toMatch(/CHECK \("personalData" = \("dataTermsId" IS NOT NULL\)\)/);
  });

  it("matches the Prisma schema (columns, relation, partial index)", () => {
    expect(SCHEMA).toMatch(/personalData\s+Boolean\s+@default\(false\)/);
    expect(SCHEMA).toMatch(/dataTermsId\s+String\?\s+@db\.Uuid/);
    expect(SCHEMA).toMatch(/dataTerms\s+AiProviderDataTerms\?\s+@relation/);
    expect(SCHEMA).toContain('map: "AiOperation_dataTermsId_idx"');
  });

  it("keeps the DP-297 lock order: switch → operation row → terms gate", () => {
    const dispatch = body("ai_dispatch");
    const sw = dispatch.indexOf("platform_module_hold_enabled('ai')");
    const op = dispatch.indexOf("FOR UPDATE");
    const terms = dispatch.indexOf("ai_terms_hold_valid");
    expect(sw).toBeGreaterThan(0);
    expect(op).toBeGreaterThan(sw);
    expect(terms).toBeGreaterThan(op);
    // The refusal comes before the dispatch stamp: no request is permitted under revoked terms.
    expect(dispatch.indexOf("'provider_terms_revoked'")).toBeLessThan(
      dispatch.indexOf('"dispatchedAt" = clock_timestamp()'),
    );
    const reserve = body("ai_reserve");
    expect(reserve.indexOf("ai_terms_hold_valid")).toBeGreaterThan(
      reserve.indexOf("platform_module_hold_enabled('ai')"),
    );
    expect(reserve.indexOf("ai_terms_hold_valid")).toBeLessThan(
      reserve.indexOf('FROM "AiSettings" WHERE "id" = 1 FOR UPDATE'),
    );
    const hold = body("ai_terms_hold");
    expect(hold.indexOf("FOR UPDATE")).toBeLessThan(hold.indexOf("ai_terms_hold_valid"));
    // Shared for the holders, exclusive for the owner, same key (class 307, provider).
    expect(body("ai_terms_hold_valid")).toContain(
      "pg_advisory_xact_lock_shared(307, hashtext(prov::text))",
    );
    expect(body("ai_provider_terms_lock")).toContain(
      "pg_advisory_xact_lock(307, hashtext(p_provider::text))",
    );
    expect(body("ai_provider_data_terms_guard")).toContain("requires ai_provider_terms_lock");
  });

  it("grants the gate to the API's role, never the internal hold", () => {
    const grant = /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO dp_app;/.exec(SQL)![1]!;
    expect(grant).toContain('ai_provider_terms_lock("AiProvider")');
    expect(grant).toContain("ai_terms_hold(uuid)");
    expect(grant).toContain("boolean, uuid)");
    expect(grant).not.toContain("ai_terms_hold_valid");
  });
});

describe("DP-307: timeouts stay within the DP-297 transaction design", () => {
  it("starts a request only while it can reach the transport before the transaction limit", () => {
    expect(DISPATCH_START_DEADLINE_MS + DISPATCH_HANDOFF_MS).toBeLessThan(WHILE_ENABLED_TIMEOUT_MS);
    expect(DISPATCH_START_DEADLINE_MS).toBeGreaterThan(WHILE_ENABLED_LOCK_TIMEOUT_MS);
  });

  it("bounds the owner's wait for the gate above the hand-off and below Prisma's 5 s transaction", () => {
    expect(TERMS_LOCK_TIMEOUT_MS).toBeGreaterThan(DISPATCH_HANDOFF_MS);
    expect(TERMS_LOCK_TIMEOUT_MS).toBeLessThan(5_000);
  });
});
