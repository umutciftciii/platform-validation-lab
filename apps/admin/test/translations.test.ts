// ML-8b: the console's language helpers (labels, ?lang=, missing units, publication languages).
import { describe, expect, it } from "vitest";
import type { SiteLanguagePublication, SiteLocale } from "@dream/contracts";
import {
  canPublishLanguages,
  languageOptions,
  localeLabel,
  missingLabel,
  parseLang,
} from "../lib/translations";
import { createTranslator } from "../lib/i18n/translate";

const t = createTranslator("en");

const locales: SiteLocale[] = [
  { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
  { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
  { locale: "de", enabled: false, public: false, isDefault: false, sortOrder: 20 },
];

const lang = (over: Partial<SiteLanguagePublication>): SiteLanguagePublication => ({
  locale: "nl",
  isDefault: false,
  public: false,
  live: false,
  hasText: true,
  state: "DRAFT",
  requiredMissing: [],
  claims: [],
  claimScan: "MANUAL",
  ...over,
});

describe("ML-8b language helpers", () => {
  it("names languages and opens only enabled ones from ?lang=", () => {
    expect(localeLabel("nl", t)).toBe("Dutch");
    expect(localeLabel("pt-BR", t)).toBe("PT-BR");
    expect(parseLang("nl", locales)).toBe("nl");
    expect(parseLang("de", locales)).toBe("en");
    expect(parseLang(["nl"], locales)).toBe("nl");
    expect(parseLang(undefined, [])).toBe("en");
  });

  it("says what is missing in words", () => {
    expect(missingLabel("listing", t)).toBe("Product text (title, summary or description)");
    expect(missingLabel("category", t)).toBe("Category name");
    expect(missingLabel("spec:kv100", t, { specs: { kv100: "Kinematic viscosity" } })).toBe(
      "Specification name: Kinematic viscosity",
    );
    expect(missingLabel("seo.ogTitle", t)).toBe("Link preview title");
    expect(missingLabel("image:x", t, { images: { x: "drum.jpg" } })).toBe(
      "Image alt text: drum.jpg",
    );
  });

  it("a language with missing units or no own text cannot be chosen", () => {
    const [o] = languageOptions(
      [lang({ isDefault: true, locale: "en" }), lang({ requiredMissing: ["category"] })],
      t,
    );
    expect(o).toEqual({
      locale: "nl",
      selectable: false,
      blockers: ["Category name"],
      needsManualReview: true,
    });
    expect(languageOptions([lang({ hasText: false })], t)[0]?.selectable).toBe(false);
  });

  it("Publish needs a confirmed manual check for Dutch, and works on an up-to-date site for Dutch only", () => {
    const options = languageOptions([lang({})], t);
    const site = { canPublish: true, listing: {} };
    const open = { canPublish: true, upToDate: false, blocking: [] };
    const upToDate = { canPublish: false, upToDate: true, blocking: [] };
    expect(canPublishLanguages(open, site, options, [], [])).toBe(true);
    expect(canPublishLanguages(open, site, options, ["nl"], [])).toBe(false);
    expect(canPublishLanguages(open, site, options, ["nl"], ["nl"])).toBe(true);
    expect(canPublishLanguages(upToDate, site, options, [], [])).toBe(false);
    expect(canPublishLanguages(upToDate, site, options, ["nl"], ["nl"])).toBe(true);
    expect(canPublishLanguages({ ...upToDate, blocking: [1] }, site, options, ["nl"], ["nl"])).toBe(
      false,
    );
    expect(
      canPublishLanguages(upToDate, { canPublish: false, listing: {} }, options, ["nl"], ["nl"]),
    ).toBe(false);
  });
});

describe("ML-12a: the language helpers in Turkish", () => {
  const tr = createTranslator("tr");
  it("names content languages as console words; unknown tags stay codes", () => {
    expect(localeLabel("en", tr)).toBe("İngilizce");
    expect(localeLabel("nl", tr)).toBe("Felemenkçe");
    expect(localeLabel("pt-BR", tr)).toBe("PT-BR");
  });
  it("says what is missing in Turkish; specification names and file names stay data", () => {
    expect(missingLabel("category", tr)).toBe("Kategori adı");
    expect(missingLabel("spec:kv100", tr, { specs: { kv100: "Kinematic viscosity" } })).toBe(
      "Teknik özellik adı: Kinematic viscosity",
    );
    expect(missingLabel("image:x", tr, { images: { x: "drum.jpg" } })).toBe(
      "Görsel alternatif metni: drum.jpg",
    );
    expect(missingLabel("image:x", tr)).toBe("Görsel alternatif metni: görsel");
    expect(missingLabel("seo.unknown", tr)).toBe("seo.unknown");
  });
});
