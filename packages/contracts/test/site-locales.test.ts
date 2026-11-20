// ML-1 (DP-073, ADR-028 D2): site language contracts — tag rule, order, publication gate.
import { describe, expect, it } from "vitest";
import {
  CmsSiteSchema,
  LocaleTagSchema,
  PublicSiteLocalesResponseSchema,
  SiteLocaleSchema,
  localeEditProblem,
  localeIsPublic,
  sortSiteLocales,
} from "../src/index.js";

const EN = { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 };
const NL = { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 };

describe("locale tags", () => {
  it("accepts the database rule and refuses anything else", () => {
    for (const ok of ["en", "nl", "pt-BR", "zh-Hant", "fil"]) {
      expect(LocaleTagSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["", "EN", "e", "english", "en_GB", "nl-", "-nl", "en-", "x".repeat(36)]) {
      expect(LocaleTagSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("keeps the admin and public shapes strict", () => {
    expect(SiteLocaleSchema.safeParse({ ...NL, extra: 1 }).success).toBe(false);
    expect(
      PublicSiteLocalesResponseSchema.safeParse({ defaultLocale: "en", locales: [] }).success,
    ).toBe(false);
    expect(
      PublicSiteLocalesResponseSchema.parse({
        defaultLocale: "en",
        locales: [{ locale: "en", isDefault: true }],
      }).locales,
    ).toHaveLength(1);
  });

  it("reads a CMS site without languages (older API) as an empty list", () => {
    const site = CmsSiteSchema.parse({
      id: "0190f2a1-0000-7000-8000-0000000000b1",
      key: "BV",
      name: "Dream Petroleum BV",
      locale: "en",
      canEdit: false,
      canPublish: false,
    });
    expect(site.locales).toEqual([]);
  });
});

describe("order", () => {
  it("lists the default first, then by sort order and tag", () => {
    const de = { ...NL, locale: "de" };
    const fr = { ...NL, locale: "fr", sortOrder: 5 };
    expect(sortSiteLocales([NL, de, fr, EN]).map((l) => l.locale)).toEqual([
      "en",
      "fr",
      "de",
      "nl",
    ]);
  });
});

describe("editing and visibility are separate", () => {
  it("opens editing and publishing to every enabled language, public or not", () => {
    expect(localeEditProblem([EN, NL], "en")).toBeNull();
    expect(localeEditProblem([EN, NL], "nl")).toBeNull();
    expect(localeEditProblem([EN, { ...NL, enabled: false }], "nl")).toBe("not_enabled");
    expect(localeEditProblem([EN, NL], "de")).toBe("not_enabled");
    expect(localeEditProblem([], "en")).toBe("not_enabled");
  });

  it("shows published content to visitors only in an enabled and public language", () => {
    expect(localeIsPublic([EN, NL], "en")).toBe(true);
    expect(localeIsPublic([EN, NL], "nl")).toBe(false);
    expect(localeIsPublic([EN, NL], "de")).toBe(false);
    expect(localeIsPublic([{ ...EN, enabled: false }], "en")).toBe(false);
  });
});
