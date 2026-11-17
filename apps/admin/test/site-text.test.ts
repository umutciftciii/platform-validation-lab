// DP-202: the hints under a site's own text fields mirror the API's fallback
// (listing text ?? product master; an empty field is saved as null).
import { describe, expect, it } from "vitest";
import { siteTextHint } from "../lib/site-text";

describe("siteTextHint", () => {
  const site = "Corporate";

  it("says the site's page uses its own text when the field is filled", () => {
    expect(siteTextHint("summary", site, "Own.", "Shared.")).toBe(
      "Shown on the Corporate product card and product page.",
    );
    expect(siteTextHint("description", site, "Own.", null)).toBe(
      "Shown on the Corporate product page. English only for now.",
    );
    expect(siteTextHint("title", site, "Own title", "Master name")).toBe(
      "Shown as the product name on Corporate.",
    );
  });

  it("names the shared text when the site field is empty or blank", () => {
    for (const own of [null, undefined, "", "   "]) {
      expect(siteTextHint("description", site, own, "Shared.")).toBe(
        "Empty: Corporate shows the shared description from “Shared product content” below.",
      );
    }
    expect(siteTextHint("title", site, null, "Master name")).toBe(
      "Empty: Corporate shows the shared name from “Shared product content” below.",
    );
  });

  it("says nothing shows when both are empty", () => {
    expect(siteTextHint("summary", site, null, null)).toBe(
      "Empty: the Corporate product card and page show no summary.",
    );
    expect(siteTextHint("description", site, "", " ")).toBe(
      "Empty: the Corporate product page shows no description.",
    );
  });
});
