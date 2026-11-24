// DP-270, DP-272, DP-275 (admin quality fixes after ML-14), in the server render and the
// dictionaries. The browser's own uppercase rendering (CSS text-transform with lang="tr") is checked
// in the isolated production-mode fixture (Dream Petroleumbv/dp-275-fixture); there is no layout
// engine in these unit tests.
import { cmsMenuSchema, type CmsTranslation } from "@dream/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { tr } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";
import { MENU_TARGETS, NAV_CONTENT } from "./support/content-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
}));

const { MenuEditor } = await import("../components/cms/menu-editor");
const { NoticeProvider } = await import("../components/catalog/notices");
const { LocaleProvider } = await import("../components/i18n/locale-provider");
const { DATA_SLOT, DataInText } = await import("../components/i18n/data-in-text");
const { translationSummaryText } = await import("../components/cms/translation-tabs");

type Tree = { [key: string]: string | Tree };
function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v]] : leaves(v, `${prefix}${k}.`),
  );
}
const EN = new Map(leaves(en as unknown as Tree));
const TR = new Map(leaves(tr as unknown as Tree));

describe("DP-270: the summary without a source-language page", () => {
  const translation = (over: Partial<CmsTranslation>): CmsTranslation => ({
    locale: "nl",
    pageId: "0190f2a1-0000-7000-8000-000000000901",
    title: "Over ons",
    path: "/nl/about",
    isSource: false,
    state: "draft",
    outdated: false,
    sourceRevisionNumber: null,
    sourceLatestRevisionNumber: null,
    ...over,
  });
  const source = translation({ locale: "en", isSource: true, title: "About", path: "/en/about" });

  it("has no repeated word in English and reads naturally in Turkish", () => {
    const current = translation({});
    expect(translationSummaryText(current, undefined, createTranslator("en"), "en")).toBe(
      "The source-language page has not been published yet.",
    );
    expect(translationSummaryText(current, undefined, createTranslator("tr"), "tr")).toBe(
      "Kaynak dildeki sayfa henüz yayınlanmadı.",
    );
    for (const locale of ["en", "tr"] as const)
      expect(
        translationSummaryText(current, undefined, createTranslator(locale), locale),
      ).not.toMatch(/\b(\w+) \1\b/i);
  });

  it("keeps every other summary text as it was", () => {
    const t = createTranslator("en");
    expect(translationSummaryText(translation({}), source, t, "en")).toBe(
      "The English (en) page has not been published yet.",
    );
    expect(
      translationSummaryText(
        translation({ outdated: true, sourceRevisionNumber: 2, sourceLatestRevisionNumber: 3 }),
        source,
        t,
        "en",
      ),
    ).toBe(
      "English (en) has revision 3; this translation was made from revision 2. Update the texts, then mark it as up to date.",
    );
    expect(
      translationSummaryText(translation({ sourceLatestRevisionNumber: 3 }), source, t, "en"),
    ).toBe("Up to date with revision 3 of English (en).");
    // The fallback name keeps its old use where the sentence does not start with "The".
    expect(
      translationSummaryText(translation({ sourceLatestRevisionNumber: 3 }), undefined, t, "en"),
    ).toBe("Up to date with revision 3 of the source language.");
  });
});

describe("DP-272: data inside uppercase UI text keeps its own language", () => {
  it("DataInText splits a message at the data slot only", () => {
    const html = (text: string) =>
      renderToStaticMarkup(<DataInText text={text} data="Services" lang="en" />);
    expect(html(`Submenu of “${DATA_SLOT}”`)).toBe(
      '<span>Submenu of “</span><span lang="en">Services</span><span>”</span>',
    );
    expect(html(`“${DATA_SLOT}” alt menüsü`)).toBe(
      '<span>“</span><span lang="en">Services</span><span>” alt menüsü</span>',
    );
    // A message without the slot shows no data (never the slot character).
    expect(html("Submenu")).toBe('<span>Submenu</span><span lang="en"></span><span></span>');
  });

  const nav = () => {
    const value = cmsMenuSchema("bv.site-nav").parse(NAV_CONTENT) as {
      items: { label: string; children: unknown[] }[];
    };
    value.items = value.items.map((item) =>
      item.label === "Products" ? { ...item, label: "Services" } : item,
    );
    return value;
  };
  const render = (locale: "en" | "tr", contentLocale: string) =>
    renderToStaticMarkup(
      <LocaleProvider locale={locale}>
        <NoticeProvider>
          <MenuEditor
            menuKey="bv.site-nav"
            value={nav() as never}
            contentLocale={contentLocale}
            targets={MENU_TARGETS as never}
            readOnly={false}
            invalid={() => undefined}
            onChange={() => undefined}
          />
        </NoticeProvider>
      </LocaleProvider>,
    );

  it("marks the menu label of the submenu heading with the menu's language (TR UI)", () => {
    const html = render("tr", "en");
    expect(html).toContain(
      '<span>“</span><span lang="en">Services</span><span>” alt menüsü</span>',
    );
    // The heading is still the uppercase eyebrow; only the language of the data piece is new.
    expect(html).toMatch(
      /<p class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3"><span>“<\/span><span lang="en">Services<\/span>/,
    );
  });

  it("uses the content language of the page, not the UI language", () => {
    expect(render("tr", "nl")).toContain('<span lang="nl">Services</span>');
    expect(render("en", "en")).toContain(
      '<span>Submenu of “</span><span lang="en">Services</span><span>”</span>',
    );
  });

  it("leaves the menu data unchanged", () => {
    const html = render("tr", "en");
    expect(html).toContain('value="Services"');
    expect(html).not.toContain("SERVİCES");
  });
});

describe("DP-275: terminology", () => {
  it("Turkish: Ürün kodu, yayındaki site, İş e-postası", () => {
    const texts = [...TR.values()];
    expect(texts.filter((x) => /\bSKU\b/.test(x))).toEqual([]);
    expect(texts.filter((x) => /canlı/i.test(x))).toEqual([]);
    expect(TR.get("companyReview.current.sku")).toBe("Ürün kodu");
    expect(TR.get("companyReview.detail.sku")).toBe("Ürün kodu");
    expect(TR.get("catalog.detail.page.sku")).toBe("Ürün kodu");
    expect(TR.get("login.workEmail")).toBe("İş e-postası");
    expect(texts.filter((x) => /yayındaki site/i.test(x)).length).toBeGreaterThanOrEqual(11);
  });

  it("English keeps SKU, live site and Work email (data and technical terms unchanged)", () => {
    expect(EN.get("companyReview.current.sku")).toBe("SKU");
    expect(EN.get("login.workEmail")).toBe("Work email");
    expect([...EN.values()].filter((x) => /live site/.test(x)).length).toBeGreaterThan(0);
  });

  it("keeps the accepted terms: Talep, Şirket incelemesi, Güncel değil", () => {
    const texts = [...TR.values()];
    expect(texts).toContain("Talepler");
    expect(texts).toContain("Şirket incelemesi");
    expect(texts).toContain("Güncel değil");
  });

  /** Every tab name of the console, in both languages. */
  const TAB_KEYS = [
    ...[...EN.keys()].filter((k) => /^catalog\.common\.tabs\./.test(k)),
    "companyReview.tabs.content",
    "companyReview.tabs.verification",
    "companyReview.tabs.sources",
    "companyReview.tabs.history",
    "content.pages.tabs.pages",
    "content.pages.tabs.news",
    "seo.tabs.overview",
    "seo.tabs.redirects",
  ];

  it("tab names are in sentence case in English and Turkish", () => {
    expect(TAB_KEYS.length).toBe(13);
    for (const [name, dict] of [
      ["en", EN],
      ["tr", TR],
    ] as const)
      for (const key of TAB_KEYS) {
        const label = dict.get(key);
        expect(label, `${name} ${key}`).toBeTypeOf("string");
        const later = label!.split(/\s+/).slice(1);
        // Only acronyms (SEO) may start with a capital after the first word.
        expect(
          later.filter((w) => /^\p{Lu}/u.test(w) && w !== w.toLocaleUpperCase("en")),
          `${name} ${key}: ${label}`,
        ).toEqual([]);
      }
    expect(EN.get("catalog.common.tabs.media")).toBe("Media & documents");
    expect(EN.get("companyReview.tabs.content")).toBe("Content review");
    expect(EN.get("companyReview.tabs.verification")).toBe("Missing & verification");
  });

  it("names the tabs in prose as they are shown", () => {
    for (const text of EN.values()) {
      expect(text).not.toMatch(/Missing & Verification|Media & Documents/);
      expect(text).not.toMatch(/Content Review(?!er)/);
    }
  });
});
