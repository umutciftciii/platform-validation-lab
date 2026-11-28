/**
 * CRM-2 (ADR-032 D6/D7, DP-339): the input rules of people, links, notes and registration
 * numbers, and the suggestion domain of a company website. The database rules are covered by the
 * integration tests (leads.int.test.ts, db-roles.int.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  CRM_NOTE_MAX,
  CrmAddPersonInputSchema,
  CrmCompanyCreateInputSchema,
  CrmCompanyUpdateInputSchema,
  CrmLeadPersonInputSchema,
  CrmNoteInputSchema,
  CrmPersonCompanyInputSchema,
  CrmRegistrationIdSchema,
} from "@dream/contracts";
import { normalizeCompanyName } from "../../../src/crm/crm-companies.service.js";
import { websiteDomain } from "../../../src/crm/crm-people.service.js";

const SITE = "0190a8b4-0000-7000-8000-000000000001";
const LEAD = "0190A8B4-0000-7000-8000-0000000000AA";

describe("CRM-2 contracts: registration numbers and same-named companies (DP-339)", () => {
  it("normalises a registration number the way the database CHECK expects it", () => {
    expect(CrmRegistrationIdSchema.parse("nl 8512.34.567 B01")).toBe("NL851234567B01");
    expect(CrmRegistrationIdSchema.parse("BE-0123/456-789")).toBe("BE0123456789");
    for (const bad of ["", "x", "NL#123", "Ä123", "1".repeat(41)]) {
      expect(CrmRegistrationIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("treats an empty registration number as not set and accepts confirmDistinct", () => {
    const parsed = CrmCompanyCreateInputSchema.parse({
      siteId: SITE,
      name: "Acme",
      registrationId: "  ",
      confirmDistinct: true,
    });
    expect(parsed).toMatchObject({ registrationId: null, confirmDistinct: true });
    expect(
      CrmCompanyUpdateInputSchema.parse({ version: 1, name: "Acme", registrationId: "kvk 1234" }),
    ).toMatchObject({ registrationId: "KVK1234" });
    expect(
      CrmCompanyCreateInputSchema.safeParse({ siteId: SITE, name: "Acme", confirmDistinct: "yes" })
        .success,
    ).toBe(false);
  });

  it("compares names like crm_normalize_name", () => {
    expect(normalizeCompanyName("  ACME \t Lubricants\nB.V. ")).toBe("acme lubricants b.v.");
  });
});

describe("CRM-2 contracts: people, links and notes", () => {
  it("parses the link inputs strictly", () => {
    expect(CrmAddPersonInputSchema.parse({ leadId: LEAD })).toEqual({ leadId: LEAD });
    expect(CrmAddPersonInputSchema.safeParse({ leadId: "nope" }).success).toBe(false);
    expect(CrmAddPersonInputSchema.safeParse({ leadId: LEAD, extra: 1 }).success).toBe(false);
    expect(CrmLeadPersonInputSchema.parse({ samePersonAsLeadId: null })).toEqual({
      samePersonAsLeadId: null,
    });
    expect(CrmLeadPersonInputSchema.safeParse({}).success).toBe(false);
    expect(CrmPersonCompanyInputSchema.safeParse({ companyId: null }).success).toBe(false);
    expect(CrmPersonCompanyInputSchema.parse({ companyId: null, version: 0 })).toEqual({
      companyId: null,
      version: 0,
    });
  });

  it("cleans a note and refuses an empty or too long one", () => {
    expect(CrmNoteInputSchema.parse({ body: "  Line 1\r\nLine 2 " })).toEqual({
      body: "Line 1\nLine 2",
    });
    expect(CrmNoteInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(CrmNoteInputSchema.safeParse({ body: "x".repeat(CRM_NOTE_MAX + 1) }).success).toBe(
      false,
    );
    expect(CrmNoteInputSchema.safeParse({ body: "bell\u0007" }).success).toBe(false);
  });
});

describe("CRM-2 suggestions: the e-mail domain of a company website", () => {
  it("takes the host without www and never a free-mail provider", () => {
    expect(websiteDomain("https://www.Northwind.example/contact")).toBe("northwind.example");
    expect(websiteDomain("http://shop.acme.example:8080")).toBe("shop.acme.example");
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain("https://localhost")).toBeNull();
    expect(websiteDomain("https://gmail.com")).toBeNull();
    expect(websiteDomain("https://www.outlook.com")).toBeNull();
  });
});
