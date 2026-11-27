// COM-1: Admin > SEO shows one site at a time (`?site=bv|corporate`); BV stays the default and its
// addresses are unchanged.
import type { CatalogSite } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { pickSeoSite, seoSites, withSeoSite } from "../lib/seo-site";

const BV: CatalogSite = {
  id: "0190f2a1-0000-7000-8000-000000000001",
  key: "BV",
  name: "Dream Petroleum BV",
  canEdit: true,
  canPublish: true,
};
const CORP: CatalogSite = {
  id: "0190f2a1-0000-7000-8000-000000000002",
  key: "CORPORATE",
  name: "Dream Petroleum",
  canEdit: true,
  canPublish: false,
};

describe("seo-site", () => {
  it("merges the CMS and catalogue sites once each, BV first", () => {
    expect(seoSites([CORP], [BV, CORP], null).map((s) => s.key)).toEqual(["BV", "CORPORATE"]);
    expect(seoSites(null, null)).toEqual([]);
  });

  it("picks the named site, else BV, else the first readable one", () => {
    expect(pickSeoSite([BV, CORP], "corporate")?.key).toBe("CORPORATE");
    expect(pickSeoSite([BV, CORP], ["corporate", "bv"])?.key).toBe("CORPORATE");
    expect(pickSeoSite([BV, CORP], undefined)?.key).toBe("BV");
    expect(pickSeoSite([BV, CORP], "nl")?.key).toBe("BV");
    expect(pickSeoSite([CORP], undefined)?.key).toBe("CORPORATE");
    expect(pickSeoSite([], "bv")).toBeUndefined();
  });

  it("keeps BV addresses as before and adds the site for the corporate one", () => {
    expect(withSeoSite("/seo", "BV")).toBe("/seo");
    expect(withSeoSite("/seo?filter=pages", "BV")).toBe("/seo?filter=pages");
    expect(withSeoSite("/seo", "CORPORATE")).toBe("/seo?site=corporate");
    expect(withSeoSite("/seo/redirects?page=2#list", "CORPORATE")).toBe(
      "/seo/redirects?page=2&site=corporate#list",
    );
  });
});
