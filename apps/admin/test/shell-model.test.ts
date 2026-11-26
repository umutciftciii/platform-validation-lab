// DP-U: route guard, navigation model, theme preference and formatting helpers.
import { describe, expect, it } from "vitest";
import { formatDelta, initials, relativeTime } from "../lib/format";
import { findSection, isActive, NAV_ITEMS, navGroupsFor } from "../lib/navigation";
import { isPublicPath, needsLoginRedirect } from "../lib/route-guard";
import { parseThemePreference, resolveTheme, THEME_INIT_SCRIPT } from "../lib/theme";

describe("route guard", () => {
  it.each(["/", "/content", "/staff", "/settings", "/anything", "/login-admin", "/loginx"])(
    "redirects %s to sign-in without a session cookie",
    (path) => {
      expect(needsLoginRedirect(path, false)).toBe(true);
      expect(needsLoginRedirect(path, true)).toBe(false);
    },
  );

  it.each([
    "/login",
    "/api/health",
    "/api/v1/auth/staff/login",
    "/_next/static/x.js",
    "/favicon.ico",
    "/brand/dream-petroleum-logo.svg",
  ])("leaves %s public", (path) => {
    expect(isPublicPath(path)).toBe(true);
    expect(needsLoginRedirect(path, false)).toBe(false);
  });
});

describe("navigation", () => {
  it("has unique slugs and hrefs", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.slug)).size).toBe(NAV_ITEMS.length);
  });

  it("marks the overview, content (CMS S1), legal texts (DP-298), products (PM-1), translations (ML-13b), SEO (DP-209), company review (DP-172), leads (DP-042), staff (DP-107), the AI Center (DP-287) and the owner console (DP-110) as ready", () => {
    expect(NAV_ITEMS.filter((i) => i.ready).map((i) => i.href)).toEqual([
      "/",
      "/content",
      "/legal-texts",
      "/products",
      "/translations",
      "/seo",
      "/company-review",
      "/leads",
      "/staff",
      "/ai",
      "/owner",
    ]);
  });

  it("hides the AI Center unless the session's aiCenter feature is on (DP-287)", () => {
    const hrefs = (owner: boolean, features?: { aiCenter?: boolean }) =>
      navGroupsFor(owner, false, features).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).not.toContain("/ai");
    expect(hrefs(false)).not.toContain("/ai");
    expect(hrefs(true, { aiCenter: false })).not.toContain("/ai");
    expect(hrefs(true, { aiCenter: true })).toContain("/ai");
    expect(hrefs(false, { aiCenter: true })).toContain("/ai");
    // A review-only user never sees it.
    expect(
      navGroupsFor(false, true, { aiCenter: true }).flatMap((g) => g.items.map((i) => i.href)),
    ).toEqual(["/company-review"]);
    // The placeholder section route never stands in for it.
    expect(findSection("ai")).toBeUndefined();
  });

  it("shows Legal texts only with the legalTexts feature, right after Content (DP-298)", () => {
    const hrefs = (owner: boolean, features?: { legalTexts?: boolean }) =>
      navGroupsFor(owner, false, features).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).not.toContain("/legal-texts");
    expect(hrefs(false, { legalTexts: false })).not.toContain("/legal-texts");
    expect(hrefs(false, { legalTexts: true })).toContain("/legal-texts");
    const list = hrefs(true, { legalTexts: true });
    expect(list[list.indexOf("/content") + 1]).toBe("/legal-texts");
    // A review-only user never sees it.
    expect(
      navGroupsFor(false, true, { legalTexts: true }).flatMap((g) => g.items.map((i) => i.href)),
    ).toEqual(["/company-review"]);
    expect(findSection("legal-texts")).toBeUndefined();
    // Its own route: the Content item is not active on it.
    const content = NAV_ITEMS.find((i) => i.slug === "content")!;
    expect(isActive(content, "/legal-texts")).toBe(false);
  });

  it("shows the owner console to the system owner only (DP-110)", () => {
    const hrefs = (owner: boolean) =>
      navGroupsFor(owner).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).toContain("/owner");
    expect(hrefs(false)).not.toContain("/owner");
    expect(navGroupsFor(false).map((g) => g.label)).not.toContain("Owner");
  });

  it("shows a review-only user (DP-172 company reviewer) the company review and nothing else", () => {
    const hrefs = navGroupsFor(false, true).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(["/company-review"]);
    expect(navGroupsFor(true, true).flatMap((g) => g.items.map((i) => i.href))).toEqual([
      "/company-review",
    ]);
    expect(navGroupsFor(false).flatMap((g) => g.items.map((i) => i.href))).toContain(
      "/company-review",
    );
  });

  it("finds module sections but never the overview or unknown slugs", () => {
    expect(findSection("staff")?.label).toBe("Staff and access");
    expect(findSection("")).toBeUndefined();
    expect(findSection("god-mode")).toBeUndefined();
  });

  it("matches the active item by path prefix, the overview only exactly", () => {
    const overview = NAV_ITEMS[0]!;
    const content = NAV_ITEMS.find((i) => i.slug === "content")!;
    expect(isActive(overview, "/")).toBe(true);
    expect(isActive(overview, "/content")).toBe(false);
    expect(isActive(content, "/content/123")).toBe(true);
    expect(isActive(content, "/contents")).toBe(false);
  });
});

describe("theme", () => {
  it("accepts only known preferences", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("neon")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("resolves system against the OS setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("ships an init script that only touches the theme attribute", () => {
    expect(THEME_INIT_SCRIPT).toContain("dataset.theme");
    expect(THEME_INIT_SCRIPT).not.toMatch(/fetch|cookie|eval\(/);
  });
});

describe("format", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  it("writes relative times", () => {
    expect(relativeTime(new Date("2026-11-11T11:59:40Z"), now)).toBe("just now");
    expect(relativeTime(new Date("2026-11-11T11:48:00Z"), now)).toBe("12 min ago");
    expect(relativeTime(new Date("2026-11-11T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-11-10T12:00:00Z"), now)).toBe("1 day ago");
    expect(relativeTime(new Date("2026-11-11T12:25:00Z"), now)).toBe("in 25 min");
  });

  it("signs deltas with a true minus", () => {
    expect(formatDelta(4.24)).toBe("+4.2%");
    expect(formatDelta(-8)).toBe("−8.0%");
    expect(formatDelta(0)).toBe("0.0%");
  });

  it("builds initials from names and emails", () => {
    expect(initials("Sanne de Vries")).toBe("SV");
    expect(initials("staff.member@example.com")).toBe("SM");
    expect(initials("umut")).toBe("U");
  });
});
