// DP-042: query helpers of the lead list (the API decides access; these only shape requests).
// DP-041: status and assignee filters.
import { LEAD_STATUSES } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import {
  countryName,
  leadListHref,
  leadListQuery,
  readLeadFilters,
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_TONE,
} from "../lib/leads-view";

const SITE = "0190f3a0-0000-7000-8000-00000000000a";

describe("lead list filters", () => {
  it("keeps only well-formed values", () => {
    expect(readLeadFilters({ site: SITE.toUpperCase(), q: "  acme ", cursor: "abc_-1" })).toEqual({
      site: SITE,
      q: "acme",
      cursor: "abc_-1",
      status: "",
      assignee: "",
    });
    expect(readLeadFilters({ site: "BV", q: ["a", "b"], cursor: "x y" })).toEqual({
      site: "",
      q: "",
      cursor: "",
      status: "",
      assignee: "",
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
  });
  it("builds the API query and the console links", () => {
    const none = { site: "", q: "", cursor: "", status: "", assignee: "" };
    expect(leadListQuery(none)).toBe("");
    expect(leadListQuery({ ...none, site: SITE, q: "a&b", cursor: "c" })).toBe(
      `?siteId=${SITE}&q=a%26b&cursor=c`,
    );
    expect(leadListQuery({ ...none, status: "NEW", assignee: "none" })).toBe(
      "?status=NEW&assignee=none",
    );
    expect(leadListHref({})).toBe("/leads");
    expect(leadListHref({ q: "acme", cursor: "n" })).toBe("/leads?q=acme&cursor=n");
    expect(leadListHref({ status: "CONTACTED", assignee: "me" })).toBe(
      "/leads?status=CONTACTED&assignee=me",
    );
  });
  it("labels every status", () => {
    for (const s of LEAD_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
      expect(STATUS_HINT[s]).toBeTruthy();
    }
  });
  it("names countries and falls back to the code", () => {
    expect(countryName("NL")).toBe("Netherlands");
    expect(countryName("not-a-code")).toBe("not-a-code");
  });
});
