/**
 * CRM-1 (ADR-032) without a database: the company input rules of the contracts (the same as the
 * database CHECKs), the catalogue (crm is core; who reads and manages companies) and the reviewed
 * shape of the migration. The database side is in test/integration/leads.int.test.ts (CRM-1
 * block) and db-roles.int.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CRM_COMPANY_LIMITS,
  CrmCompanyCreateInputSchema,
  CrmCompanyUpdateInputSchema,
  CrmOwnerFilterSchema,
} from "@dream/contracts";
import { MODULE_BY_KEY, ROLE_BY_KEY } from "../../../src/iam/catalog.js";

const SITE = "0195f1a0-0000-7000-8000-000000000001";
const USER = "0195F1A0-0000-7000-8000-0000000000AA";
const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../prisma/migrations",
);
const M51 = "20261224090000_crm_1_companies";
const SQL = readFileSync(path.join(MIGRATIONS, M51, "migration.sql"), "utf8");
/** The SQL without comments (the migration checker reads it the same way). */
const CODE = SQL.replace(/--[^\n]*/g, "");

describe("CRM-1 contracts: company input", () => {
  it("normalises text, makes empty fields null and lower-cases e-mail and owner id", () => {
    const parsed = CrmCompanyCreateInputSchema.parse({
      siteId: SITE,
      name: "  Cafe\u0301   B.V. ",
      country: "",
      city: "   ",
      address: "Haven 1\r\n3011 Rotterdam ",
      website: "https://acme.example/path?x=1",
      phone: "+31 (0)10 123-4567",
      email: " Info@ACME.Example ",
      description: null,
      ownerUserId: USER,
    });
    expect(parsed).toEqual({
      siteId: SITE,
      // NFC (one code point for é), trimmed; inner spaces stay (the database key collapses them).
      name: "Caf\u00e9   B.V.",
      country: null,
      city: null,
      address: "Haven 1\n3011 Rotterdam",
      website: "https://acme.example/path?x=1",
      phone: "+31 (0)10 123-4567",
      email: "info@acme.example",
      description: null,
      internalNotes: null,
      ownerUserId: USER.toLowerCase(),
    });
  });

  it("refuses what the database CHECKs refuse", () => {
    const bad = (patch: Record<string, unknown>) =>
      CrmCompanyCreateInputSchema.safeParse({ siteId: SITE, name: "Acme", ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ name: " " })).toBe(false);
    expect(bad({ name: "a\tb" })).toBe(false);
    expect(bad({ name: "x".repeat(CRM_COMPANY_LIMITS.name + 1) })).toBe(false);
    expect(bad({ city: "Line\nbreak" })).toBe(false);
    expect(bad({ address: "Line\nbreak" })).toBe(true);
    for (const website of [
      "ftp://acme.example",
      "acme.example",
      "https://acme",
      "https://a b.nl",
    ]) {
      expect(bad({ website }), website).toBe(false);
    }
    for (const phone of ["call me", "12", "-123456", "+31 10 123 4567 ext. 5"]) {
      expect(bad({ phone }), phone).toBe(false);
    }
    expect(bad({ email: "info@acme" })).toBe(false);
    expect(bad({ country: "XX" })).toBe(false);
    expect(bad({ country: "nl" })).toBe(false);
    expect(bad({ ownerUserId: "someone" })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    expect(CrmCompanyUpdateInputSchema.safeParse({ name: "Acme" }).success).toBe(false);
    expect(CrmCompanyUpdateInputSchema.safeParse({ version: -1, name: "Acme" }).success).toBe(
      false,
    );
    expect(CrmCompanyUpdateInputSchema.safeParse({ version: 0, name: "Acme" }).success).toBe(true);
  });

  it("filters the list by me, none or a staff id", () => {
    expect(CrmOwnerFilterSchema.safeParse("me").success).toBe(true);
    expect(CrmOwnerFilterSchema.safeParse("none").success).toBe(true);
    expect(CrmOwnerFilterSchema.safeParse(SITE).success).toBe(true);
    expect(CrmOwnerFilterSchema.safeParse("anyone").success).toBe(false);
  });
});

describe("CRM-1 catalogue (ADR-032 D1, D3)", () => {
  it("makes CRM 360° a core module", () => {
    expect(MODULE_BY_KEY.get("crm")).toMatchObject({ isCore: true, name: "CRM 360°" });
  });

  it("gives company access to the sales role, the super admin and (read) the officer", () => {
    const perms = (key: string) => ROLE_BY_KEY.get(key)?.permissions ?? [];
    expect(perms("sales_crm_user")).toEqual(expect.arrayContaining(["crm:read", "crm:manage"]));
    expect(perms("platform_super_admin")).toEqual(
      expect.arrayContaining(["crm:read", "crm:manage"]),
    );
    expect(perms("platform_customer_data_officer")).toContain("crm:read");
    expect(perms("platform_customer_data_officer")).not.toContain("crm:manage");
    for (const role of ["site_admin", "content_editor", "product_editor", "read_only"]) {
      expect(
        perms(role).filter((p) => p.startsWith("crm:")),
        role,
      ).toEqual([]);
    }
  });
});

describe("CRM-1 migration 51", () => {
  it("follows migration 50 directly and checks the lead workflow is applied first", () => {
    const names = readdirSync(MIGRATIONS)
      .filter((n) => /^\d{14}_/.test(n))
      .sort();
    expect(names.indexOf(M51)).toBe(
      names.indexOf("20261223090000_dp_307_dispatch_terms_recheck") + 1,
    );
    expect(SQL).toMatch(/RAISE EXCEPTION 'CRM-1: migration 20261124090000_dp_041/);
  });

  it("has no destructive statement and never grants DELETE", () => {
    expect(CODE).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE)\b|\bDELETE\s+FROM\b/i);
    expect(CODE).not.toMatch(/(?<!\b(?:BEFORE|AFTER|OR)\s+)\bTRUNCATE\b/i);
    expect(CODE).toMatch(/REVOKE DELETE ON TABLE "CrmCompany" FROM dp_app;/);
    expect(CODE).not.toMatch(/GRANT[^;]*DELETE[^;]*"CrmCompany"/);
  });

  it("puts the table behind row-level security and pins every definer's search_path", () => {
    expect(CODE).toMatch(/ALTER TABLE "CrmCompany" ENABLE ROW LEVEL SECURITY;/);
    const definers = [
      ...CODE.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION (\w+)\([^)]*\)[^$]*?SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp/g,
      ),
    ].map((m) => m[1]);
    expect(definers.sort()).toEqual([
      "crm_rls_assignable_owners",
      "crm_rls_owner_ok",
      "crm_rls_staff_manage_site_ids",
      "crm_rls_staff_read_site_ids",
      "leads_rls_user_lead_sites",
    ]);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION crm_rls_staff_read_site_ids\(\)/);
  });

  it("only upgrades the crm catalogue row (never a downgrade)", () => {
    expect(CODE).toMatch(
      /UPDATE "FeatureModule"\s+SET "isCore" = true[\s\S]*WHERE "key" = 'crm' AND NOT "isCore";/,
    );
  });
});
