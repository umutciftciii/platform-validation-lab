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

describe("DP-275: the English dictionary changed only where approved", () => {
  const before = load("dp275-en", "en-dictionary");
  const now = leaves(en as unknown as Tree);

  it("changes only the tab names and the sentences naming them", () => {
    const changed = Object.keys(before)
      .filter((k) => k in now && now[k] !== before[k])
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
    expect(Object.keys(now).filter((k) => !(k in before) && !ml13b(k))).toEqual([
      "content.editor.translationTabs.summary.notPublishedNoSource",
    ]);
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
      const after = load("catalog-en", file);
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
