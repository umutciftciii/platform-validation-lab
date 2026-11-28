/**
 * CRM-3 (ADR-032 D11): the contracts of the 360° views — filters, limits and the answers the
 * console parses. The reads themselves (access, sites, audit, row-level security) are covered by
 * the integration tests (leads.int.test.ts, "CRM-3 360° views").
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_CRM_OVERVIEW_API,
  CRM_360_LIMIT,
  CRM_CONTACT_KINDS,
  CrmCompanyListItemSchema,
  CrmContactEntrySchema,
  CrmOverviewResponseSchema,
  CrmPeopleCompanyFilterSchema,
} from "@dream/contracts";

const ID = "0190a8b4-0000-7000-8000-000000000001";
const AT = "2026-11-28T10:00:00.000Z";

describe("CRM-3 contracts", () => {
  it("names the overview route and keeps the sections bounded", () => {
    expect(ADMIN_CRM_OVERVIEW_API).toBe("/api/v1/admin/crm/overview");
    expect(CRM_360_LIMIT).toBe(100);
    // CRM-4 adds kinds; CRM-3 knows these two.
    expect(CRM_CONTACT_KINDS).toEqual(["FORM_MESSAGE", "LOGGED_CONTACT"]);
  });

  it("accepts the company filter of the people list: any, none or an id", () => {
    for (const ok of ["any", "none", ID]) {
      expect(CrmPeopleCompanyFilterSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["", "all", "me", "123"]) {
      expect(CrmPeopleCompanyFilterSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("keeps the people counts of the overview null without lead access, never invented", () => {
    const base = {
      sites: [],
      counts: {
        companies: 0,
        myCompanies: 0,
        companiesWithoutOwner: 0,
        people: null,
        peopleWithoutCompany: null,
      },
      recentCompanies: [],
    };
    expect(CrmOverviewResponseSchema.safeParse(base).success).toBe(true);
    expect(
      CrmOverviewResponseSchema.safeParse({
        ...base,
        counts: { ...base.counts, people: -1 },
      }).success,
    ).toBe(false);
    // Strict: no extra (sample) figures.
    expect(
      CrmOverviewResponseSchema.safeParse({ ...base, counts: { ...base.counts, revenue: 1 } })
        .success,
    ).toBe(false);
  });

  it("describes a contact entry with a known kind and channel", () => {
    const entry = {
      id: ID,
      kind: "LOGGED_CONTACT",
      at: AT,
      lead: { id: ID, label: null },
      person: null,
      actor: { id: ID, displayName: "Staff" },
      channel: "PHONE",
      subject: null,
      body: null,
      phone: null,
    };
    expect(CrmContactEntrySchema.safeParse(entry).success).toBe(true);
    expect(CrmContactEntrySchema.safeParse({ ...entry, kind: "EMAIL_SYNC" }).success).toBe(false);
    expect(CrmContactEntrySchema.safeParse({ ...entry, channel: "FAX" }).success).toBe(false);
  });

  it("lets a company row carry its people count and last activity, or null", () => {
    const row = {
      id: ID,
      siteId: ID,
      siteKey: "BV",
      name: "Acme",
      registrationId: null,
      country: null,
      city: null,
      website: null,
      owner: null,
      updatedAt: AT,
      peopleCount: null,
      lastActivityAt: null,
    };
    expect(CrmCompanyListItemSchema.safeParse(row).success).toBe(true);
    expect(
      CrmCompanyListItemSchema.safeParse({ ...row, peopleCount: 2, lastActivityAt: AT }).success,
    ).toBe(true);
    expect(CrmCompanyListItemSchema.safeParse({ ...row, peopleCount: -1 }).success).toBe(false);
  });
});
