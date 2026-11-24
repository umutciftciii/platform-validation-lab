// DP-042: query helpers of the lead list (the API decides access; these only shape requests).
// DP-041: status and assignee filters.
import { LEAD_STATUSES } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import {
  calendarDay,
  countryName,
  exportSummaryText,
  formLanguageLabel,
  hasLeadFilters,
  leadCount,
  leadExportQuery,
  leadListHref,
  leadListQuery,
  readLeadFilters,
  statusHint,
  statusLabel,
  STATUS_TONE,
  textLanguageLabel,
} from "../lib/leads-view";
import { createTranslator } from "../lib/i18n/translate";

// ML-12e: labels and texts take the UI language's t() (English here, as before).
const EN = createTranslator("en");

const SITE = "0190f3a0-0000-7000-8000-00000000000a";

describe("lead list filters", () => {
  it("keeps only well-formed values", () => {
    expect(readLeadFilters({ site: SITE.toUpperCase(), q: "  acme ", cursor: "abc_-1" })).toEqual({
      site: SITE,
      q: "acme",
      cursor: "abc_-1",
      status: "",
      assignee: "",
      source: "",
      from: "",
      to: "",
    });
    expect(readLeadFilters({ site: "BV", q: ["a", "b"], cursor: "x y" })).toEqual({
      site: "",
      q: "",
      cursor: "",
      status: "",
      assignee: "",
      source: "",
      from: "",
      to: "",
    });
    expect(readLeadFilters({ status: "qualified", assignee: "ME" })).toMatchObject({
      status: "QUALIFIED",
      assignee: "me",
    });
    expect(readLeadFilters({ status: "WON", assignee: SITE })).toMatchObject({
      status: "",
      assignee: "",
    });
    expect(readLeadFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    // DP-221: only the two known sources.
    expect(readLeadFilters({ source: "contact_form" }).source).toBe("CONTACT_FORM");
    expect(readLeadFilters({ source: "FAIR" }).source).toBe("");
  });
  it("builds the API query and the console links", () => {
    const none = {
      site: "",
      q: "",
      cursor: "",
      status: "",
      assignee: "",
      source: "",
      from: "",
      to: "",
    };
    expect(leadListQuery(none)).toBe("");
    expect(leadListQuery({ ...none, site: SITE, q: "a&b", cursor: "c" })).toBe(
      `?siteId=${SITE}&q=a%26b&cursor=c`,
    );
    expect(leadListQuery({ ...none, status: "NEW", assignee: "none" })).toBe(
      "?status=NEW&assignee=none",
    );
    // DP-221: the source filter.
    expect(leadListQuery({ ...none, source: "CONTACT_FORM" })).toBe("?source=CONTACT_FORM");
    expect(leadListHref({ source: "DOCUMENT_REQUEST" })).toBe("/leads?source=DOCUMENT_REQUEST");
    expect(leadListHref({})).toBe("/leads");
    expect(leadListHref({ q: "acme", cursor: "n" })).toBe("/leads?q=acme&cursor=n");
    expect(leadListHref({ status: "CONTACTED", assignee: "me" })).toBe(
      "/leads?status=CONTACTED&assignee=me",
    );
  });
  it("labels every status", () => {
    for (const s of LEAD_STATUSES) {
      expect(statusLabel(s, EN)).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
      expect(statusHint(s, EN)).toBeTruthy();
    }
  });
  it("names countries and falls back to the code", () => {
    expect(countryName("NL", "en")).toBe("Netherlands");
    expect(countryName("not-a-code", "en")).toBe("not-a-code");
  });
});

// DP-227: creation date range and the CSV export of the filtered leads.
describe("date range and export", () => {
  it("keeps real calendar days only and drops an end before the start", () => {
    expect(readLeadFilters({ from: "2026-11-01", to: "2026-11-19" })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-19",
    });
    expect(readLeadFilters({ from: "2026-02-30", to: "19-11-2026" })).toMatchObject({
      from: "",
      to: "",
    });
    expect(readLeadFilters({ from: "2026-11-19", to: "2026-11-01" })).toMatchObject({
      from: "2026-11-19",
      to: "",
    });
    expect(calendarDay("2028-02-29")).toBe("2028-02-29");
    expect(calendarDay("1999-12-31")).toBe("");
  });

  it("sends the same filters to the list, the export and its summary (no cursor)", () => {
    const f = readLeadFilters({
      site: SITE,
      q: "acme",
      status: "NEW",
      source: "CONTACT_FORM",
      assignee: "me",
      from: "2026-11-01",
      to: "2026-11-19",
      cursor: "abc",
    });
    expect(leadListQuery(f)).toBe(
      `?siteId=${SITE}&q=acme&status=NEW&assignee=me&source=CONTACT_FORM&from=2026-11-01&to=2026-11-19&cursor=abc`,
    );
    expect(leadExportQuery(f)).toBe(
      `?siteId=${SITE}&q=acme&status=NEW&assignee=me&source=CONTACT_FORM&from=2026-11-01&to=2026-11-19`,
    );
    expect(leadListHref({ ...f, cursor: "" })).toBe(
      `/leads?site=${SITE}&q=acme&status=NEW&assignee=me&source=CONTACT_FORM&from=2026-11-01&to=2026-11-19`,
    );
    expect(leadExportQuery(readLeadFilters({}))).toBe("");
    expect(hasLeadFilters(readLeadFilters({ site: SITE }))).toBe(false);
    expect(hasLeadFilters(readLeadFilters({ from: "2026-11-01" }))).toBe(true);
  });

  it("says how many leads the export holds, or why there is nothing to export", () => {
    expect(leadCount(1, EN, "en")).toBe("1 lead");
    expect(leadCount(1234, EN, "en")).toBe("1,234 leads");
    expect(exportSummaryText(0, 20000, true, EN, "en")).toBe(
      "No leads match these filters, so there is nothing to export.",
    );
    expect(exportSummaryText(0, 20000, false, EN, "en")).toBe("There are no leads to export yet.");
    expect(exportSummaryText(12, 20000, true, EN, "en")).toBe(
      "12 leads match these filters and will be exported.",
    );
    expect(exportSummaryText(1, 20000, false, EN, "en")).toBe(
      "1 lead in total and will be exported.",
    );
    expect(exportSummaryText(20001, 20000, false, EN, "en")).toMatch(
      /^20,001 leads match\. One export holds at most 20,000; narrow the filters/,
    );
  });
});

describe("ML-10 form and text language labels", () => {
  it("shows the stored form language; a row from before ML-10 as English, marked not recorded", () => {
    expect(formLanguageLabel("en", EN)).toBe("English");
    expect(formLanguageLabel("nl", EN)).toBe("Dutch");
    expect(formLanguageLabel(null, EN)).toBe("English (not recorded, before ML-10)");
    expect(formLanguageLabel("pt-BR", EN)).toBe("pt-BR");
    expect(formLanguageLabel("constructor", EN)).toBe("constructor");
  });

  it("names the language of a text version (older versions were English)", () => {
    expect(textLanguageLabel("2026-11-12.en", EN)).toBe("English");
    expect(textLanguageLabel("2026-11-23.nl", EN)).toBe("Dutch");
    expect(textLanguageLabel("2026-11-11", EN)).toBe("English");
  });
});
