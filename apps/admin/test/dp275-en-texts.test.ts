// DP-270, DP-272, DP-275: the English console changed only where approved.
//
// 1. Dictionary. fixtures/dp275-en/en-dictionary.json.gz is every English message of private main
//    8a6fa70 (ML-14), flattened. Against it, the only changed messages are the tab names in
//    sentence case (Media & documents, Content review, Missing & verification) and the sentences
//    that name those tabs; the only new message is DP-270's notPublishedNoSource. Nothing else in
//    English changed, removed or added — including messages no render test reaches.
// 2. Renders. content-en, seo-en, company-review-en, company-review-render and product-tabs were
//    recorded again (DP275_RECORD_EN=1); their ML-14 recording is kept in fixtures/dp275-en. Every
//    render of the new recording equals the old one after exactly these changes:
//    - the approved tab names (as in 1);
//    - DP-272: the menu label inside the "Submenu of “…”" heading is its own <span lang="…">
//      (the sentence is three spans, same text), and the link preview's host carries lang="en"
//      (product SEO tab, SEO overview and the CMS page SEO preview).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDERS = [
  "content-en",
  "seo-en",
  "company-review-en",
  "company-review-render",
  "product-tabs",
] as const;

function load(dir: string, file: string): Record<string, string> {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, `${file}.json.gz`))).toString("utf8"),
  );
}

/** The approved English changes of DP-275 (tab names in sentence case, in prose too). */
function approved(text: string): string {
  return text
    .replaceAll("Media &amp; Documents", "Media &amp; documents")
    .replaceAll("Media & Documents", "Media & documents")
    .replace(/Content Review(?!er)/g, "Content review")
    .replaceAll("Missing &amp; Verification", "Missing &amp; verification")
    .replaceAll("Missing & Verification", "Missing & verification");
}

type Tree = { [key: string]: string | Tree };
function leaves(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[`${prefix}${k}`] = v;
    else Object.assign(out, leaves(v, `${prefix}${k}.`));
  }
  return out;
}

/**
 * COM-1: Admin > SEO shows the chosen site (BV or the corporate site), so the two descriptions that
 * named dreampetroleumbv.com name "the chosen site"; nothing else of their wording changed.
 */
/** COM-1: the render recordings it replaced (kept in fixtures/com1-en, see com1-en-texts). */
const COM1_REPLACED: readonly string[] = ["seo-en", "content-en"];

const COM1_CHANGED: Readonly<Record<string, string>> = {
  "seo.overview.description":
    "Search results and link previews of the chosen site: the site defaults and the SEO of every page, article and product. Changes reach the site when the page or product is published.",
  "seo.redirects.description":
    "Old addresses of the chosen site and where they lead. Changes take effect on the site at once.",
};

/**
 * COM-2b: the registry note of the corporate home page describes the designed page now (it was
 * "Skeleton today"), word for word the contract text.
 */
const COM2B_CHANGED: Readonly<Record<string, string>> = {
  "content.contract.registry.corporateHome":
    "Hero, company overview, services, product groups, strengths and a call to action (COM-2b). No counters, distributorship claims or testimonials.",
};
/**
 * COM-2b: the field texts of the corporate home page and portfolio, and the portfolio's note.
 * COM-3: the note of the corporate news list heading (its fields are the BV heading's texts).
 * COM-4: the note of the corporate contact page.
 */
const com2b = (k: string) =>
  k.startsWith("content.contract.design.corporate") ||
  k === "content.contract.registry.corporateProducts" ||
  k === "content.contract.registry.corporateNewsIndex" ||
  k === "content.contract.registry.corporateContact" ||
  // COM-5: the notes of the live site's pages and posts, the article's original date.
  k === "content.contract.registry.corporateContentPage" ||
  k === "content.contract.registry.corporateContentArticle" ||
  k === "content.contract.article.originalDateLabel" ||
  k === "content.contract.article.originalDateHint";

describe("COM-2b: the corporate designed pages' contract texts", () => {
  it("changes only the home page's registry note and adds only the new field texts", () => {
    const before = load("dp275-en", "en-dictionary");
    const now = leaves(en as unknown as Tree);
    for (const [k, text] of Object.entries(COM2B_CHANGED)) {
      expect(now[k], k).toBe(text);
      expect(before[k], k).toBe(
        "Skeleton today. Built from the dreampetroleum.com inventory in S4.",
      );
    }
    const added = Object.keys(now).filter((k) => !(k in before) && com2b(k));
    // COM-3: +1, the corporate news list heading's registry note. COM-4: +1, the contact page's.
    // COM-5: +4 (two registry notes, the original date's label and hint). COM-7: +8 (a hero's
    // background image, the pictures' hint, the activity areas and the latest news heading).
    expect(added).toHaveLength(45);
    expect(now["content.contract.registry.corporateContact"]).toBe(
      "Contact details from the published footer and the contact form; messages become CORPORATE leads in the CRM (COM-4).",
    );
    expect(now["content.contract.registry.corporateNewsIndex"]).toBe(
      "Heading, introduction and empty state of the corporate news list (COM-3). The articles are under News.",
    );
  });
});

/**
 * CRM-1 (ADR-032 D1): CRM 360° is standard scope and a core module, no longer the optional sales
 * pipeline: the Owner Console names it as such.
 */
const CRM1_CHANGED: Readonly<Record<string, readonly [before: string, now: string]>> = {
  "owner.modules.crm.name": ["CRM", "CRM 360°"],
  "owner.modules.crm.description": [
    "Sales pipeline on top of leads (optional)",
    "Companies, contacts, account owners and contact history",
  ],
};

describe("CRM-1: the Owner Console names CRM 360°", () => {
  it("changes exactly the CRM module's name and description", () => {
    const before = load("dp275-en", "en-dictionary");
    const now = leaves(en as unknown as Tree);
    for (const [k, [was, is]] of Object.entries(CRM1_CHANGED)) {
      expect(before[k], k).toBe(was);
      expect(now[k], k).toBe(is);
    }
  });
});

describe("COM-1: the SEO descriptions name the chosen site", () => {
  it("changes exactly the two descriptions, the site name only", () => {
    const before = load("dp275-en", "en-dictionary");
    const now = leaves(en as unknown as Tree);
    for (const [k, text] of Object.entries(COM1_CHANGED)) {
      expect(now[k], k).toBe(text);
      expect(before[k]!.replace("dreampetroleumbv.com", "the chosen site"), k).toBe(text);
    }
  });
});

describe("DP-275: the English dictionary changed only where approved", () => {
  const before = load("dp275-en", "en-dictionary");
  const now = leaves(en as unknown as Tree);

  it("changes only the tab names and the sentences naming them", () => {
    const changed = Object.keys(before)
      .filter(
        (k) =>
          k in now &&
          now[k] !== before[k] &&
          !(k in COM1_CHANGED) &&
          !(k in COM2B_CHANGED) &&
          !(k in CRM1_CHANGED),
      )
      .sort();
    expect(changed).toEqual([
      "catalog.common.tabs.media",
      "companyReview.comparison.empty",
      "companyReview.decision.commentPlaceholder",
      "companyReview.editor.placeholderNote",
      "companyReview.editor.reviewNotes",
      "companyReview.tabs.content",
      "companyReview.tabs.verification",
    ]);
    for (const k of changed) expect(now[k], k).toBe(approved(before[k]!));
  });

  it("removes nothing and adds only DP-270's message", () => {
    expect(Object.keys(before).filter((k) => !(k in now))).toEqual([]);
    // ML-13b (DP-244) adds a new screen: its own module and its navigation entry, nothing else.
    const ml13b = (k: string) =>
      k.startsWith("translationPackages.") || k.startsWith("nav.items.translations.");
    expect(Object.keys(before).filter(ml13b)).toEqual([]);
    // DP-287 (ADR-030) adds the AI Center (its module and navigation entry) and the Owner
    // Console's platform-module switch; no existing text changes.
    const dp287 = (k: string) =>
      k.startsWith("ai.") ||
      k.startsWith("nav.items.ai.") ||
      k.startsWith("owner.modules.ai.") ||
      [
        "owner.console.platformPanel",
        "owner.console.platformDescription",
        "owner.console.platformState",
        "owner.switch.platformOnLabel",
        "owner.switch.platformOffLabel",
        "owner.switch.hintPlatformOff",
        "owner.switch.hintPlatformOn",
      ].includes(k) ||
      // DP-288 adds the two AI roles' texts (staff.roles.*) to the same screen family.
      k.startsWith("staff.roles.ai_administrator.") ||
      k.startsWith("staff.roles.ai_viewer.");
    expect(Object.keys(before).filter(dp287)).toEqual([]);
    // DP-298 (ADR-031) adds the legal texts screen, the lead consents panel and the AI providers'
    // data-processing terms (one module, legal.*) and the navigation entry; no existing text changes.
    const dp298 = (k: string) => k.startsWith("legal.") || k.startsWith("nav.items.legalTexts.");
    expect(Object.keys(before).filter(dp298)).toEqual([]);
    // CRM-1 (ADR-032) adds the CRM area (one module, crm.*) and its navigation entry.
    const crm1 = (k: string) => k.startsWith("crm.") || k.startsWith("nav.items.crm.");
    expect(Object.keys(before).filter(crm1)).toEqual([]);
    // DP-285 adds the message of the new API error code DATABASE_UNAVAILABLE.
    expect(
      Object.keys(now).filter(
        (k) => !(k in before) && !ml13b(k) && !dp287(k) && !dp298(k) && !com2b(k) && !crm1(k),
      ),
    ).toEqual([
      "errors.DATABASE_UNAVAILABLE",
      // COM-1: the notes of the corporate fragments in Content (CMS_SITE_REGISTRY, contract texts).
      "content.contract.registry.corporateSiteNav",
      "content.contract.registry.corporateSiteFooter",
      "content.contract.registry.corporateSiteSeo",
      "content.editor.translationTabs.summary.notPublishedNoSource",
      // COM-1: the site switcher of Admin > SEO.
      "seo.common.site",
    ]);
    expect(now["seo.common.site"]).toBe("Site");
    expect(now["errors.DATABASE_UNAVAILABLE"]).toBe(
      "The database is not available right now. Try again later.",
    );
    expect(now["content.editor.translationTabs.summary.notPublishedNoSource"]).toBe(
      "The source-language page has not been published yet.",
    );
    expect(Object.keys(before).length).toBe(2793);
  });
});

/** The new markup with the DP-272 language marks folded back into the old shape. */
function withoutLanguageMarks(html: string): { html: string; split: number; host: number } {
  let split = 0;
  let host = 0;
  const out = html
    .replace(
      /<span>([^<]*)<\/span><span lang="[a-z]{2}">([^<]*)<\/span><span>([^<]*)<\/span>/g,
      (_m, a: string, b: string, c: string) => {
        split++;
        return `<span>${a}${b}${c}</span>`;
      },
    )
    .replace(/<p lang="en" (class="truncate text-\[11px\] uppercase)/g, (_m, cls: string) => {
      host++;
      return `<p ${cls}`;
    });
  return { html: out, split, host };
}

describe("DP-270/272/275: EN renders changed only where approved", () => {
  for (const file of RENDERS) {
    it(file, () => {
      const before = load("dp275-en", file);
      // COM-1 recorded seo-en and content-en again; the recording it replaced is the DP-275 one.
      const after = load(COM1_REPLACED.includes(file) ? "com1-en" : "catalog-en", file);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      let changed = 0;
      let splits = 0;
      let hosts = 0;
      for (const key of Object.keys(before)) {
        const { html, split, host } = withoutLanguageMarks(after[key]!);
        splits += split;
        hosts += host;
        expect(html, `${file} ${key}`).toBe(approved(before[key]!));
        if (after[key] !== before[key]) changed++;
      }
      expect(changed, `${file}: renders that changed`).toBeGreaterThan(0);
      // The language marks show up exactly where DP-272 put them.
      if (file === "content-en") expect(splits).toBeGreaterThan(0);
      else expect(splits).toBe(0);
      if (file.startsWith("company-review")) expect(hosts).toBe(0);
      else expect(hosts).toBeGreaterThan(0);
    });
  }
});
