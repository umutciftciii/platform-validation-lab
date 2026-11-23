// ML-12a (DP-243) static check of the Products/Catalog area (see support/ui-literals.ts):
//   1. no user-visible English text is written in code any more — it lives in the dictionary;
//   2. every text the area showed before ML-12a (recorded on private main 88251eb with
//      ML12A_RECORD_EN=1 in fixtures/catalog-en/ui-literals.json) is still in the English
//      dictionary, word for word — including messages no render test reaches (errors, confirmations,
//      modals, toasts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { listFiles, scanFiles, scanSource } from "./support/ui-literals";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "test", "fixtures", "catalog-en", "ui-literals.json");
const RECORD = process.env["ML12A_RECORD_EN"] === "1";

/**
 * The Products/Catalog area of ML-12a. Company Review (proposal-review, proposal-decision,
 * proposal-editor, review-tabs) is ML-12b; the SEO module's own screens are ML-12d.
 */
export const CATALOG_SCOPE = [
  "app/(console)/products",
  "components/catalog/category-manager.tsx",
  "components/catalog/cross-reference-manager.tsx",
  "components/catalog/document-manager.tsx",
  "components/catalog/global-catalog.tsx",
  "components/catalog/image-manager.tsx",
  "components/catalog/language-nav.tsx",
  "components/catalog/language-publication.tsx",
  "components/catalog/listing-form.tsx",
  "components/catalog/notices.tsx",
  "components/catalog/parts.tsx",
  "components/catalog/preview-link-button.tsx",
  "components/catalog/product-master-form.tsx",
  "components/catalog/product-seo-form.tsx",
  "components/catalog/product-tabs.tsx",
  "components/catalog/review-queue.tsx",
  "components/catalog/spec-definitions.tsx",
  "components/catalog/spec-editor.tsx",
  "components/catalog/translation-editor.tsx",
  "components/catalog/workflow.tsx",
  "components/seo/seo-fields.tsx",
  "components/seo/seo-preview.tsx",
  "lib/catalog-client.ts",
  "lib/catalog-view.ts",
  "lib/listing-request.ts",
  "lib/product-tabs.ts",
  "lib/publication-status.ts",
  "lib/spec-validation.ts",
  "lib/translations.ts",
] as const;

/**
 * Literals the baseline scan recorded that were never UI text (the scanner's rules were refined
 * after recording): DOM id and React key fragments, CSS, a time zone, an HTTP header, a query
 * string and a site name. Each is code or data and stays in code, marked `i18n-ignore`.
 */
const NOT_UI_IN_BASELINE = new Set([
  "Europe/Amsterdam",
  "tr-",
  "-listing-",
  "-category-",
  "-specs-",
  "-alts-",
  "-alt-",
  "-seo-",
  "seo-",
  "cat-",
  "listing-",
  "site=",
  "px-0! pb-2! pt-3!",
  "px-0! pb-5! pt-3!",
  "calc(1.25rem +",
  "rem)",
  "Content-Type",
  "Corporate",
]);

/** JSX text is written with entities (`&apos;`); the dictionary holds the rendered characters. */
const decode = (s: string) =>
  s
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

/** A dictionary message as a pattern: each `{parameter}` stands for any text. */
const asPattern = (message: string) =>
  new RegExp(
    `^${message
      .split(/\{\w+\}/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*?")}$`,
  );

/** Every English dictionary value, whitespace collapsed (plural forms included). */
function englishTexts(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v.replace(/\s+/g, " "));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(en);
  return out;
}

describe("Products/Catalog: no hard-coded UI text (ML-12a)", () => {
  const files = listFiles(ROOT, CATALOG_SCOPE);

  it("scans the whole area", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("records the English UI text of the area (baseline, private main 88251eb)", () => {
    if (!RECORD) return;
    const found = scanFiles(ROOT, files);
    const byFile: Record<string, string[]> = {};
    for (const l of found) (byFile[l.file] ??= []).push(l.text);
    mkdirSync(path.dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(byFile, null, 1)}\n`);
  });

  it.skipIf(RECORD)("leaves no English UI text in code", () => {
    const found = scanFiles(ROOT, files).map((l) => `${l.file}:${l.line}  ${l.text}`);
    expect(found).toEqual([]);
  });

  it.skipIf(RECORD)("keeps every English text of before ML-12a in the dictionary", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string[]>;
    const messages = englishTexts();
    const dictionary = messages.join("\n");
    const patterns = messages.filter((m) => m.includes("{")).map(asPattern);
    const missing: string[] = [];
    for (const [file, texts] of Object.entries(baseline)) {
      for (const text of texts) {
        // a template's static parts each exist; `{…}` was a value, now a `{parameter}`
        for (const raw of text.split("{…}").map((p) => p.trim())) {
          const part = decode(raw);
          if (!/[A-Za-z]{2,}/.test(part) || NOT_UI_IN_BASELINE.has(part)) continue;
          // a value written into the sentence (e.g. a permission key) is a parameter now
          if (!dictionary.includes(part) && !patterns.some((re) => re.test(part)))
            missing.push(`${file}: ${part}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the scanner itself", () => {
  const scan = (code: string) => scanSource("x.tsx", code).map((l) => l.text);

  it("reports JSX text, visible attributes and messages", () => {
    expect(scan(`const a = <p title="Open the file">Save changes</p>;`)).toEqual([
      "Open the file",
      "Save changes",
    ]);
    expect(scan('const m = cond ? "Saved." : `Removed ${n} items.`;')).toEqual([
      "Saved.",
      "Removed {…} items.",
    ]);
    expect(scan(`notify({ tone: "ok", message: "The image was uploaded." });`)).toEqual([
      "The image was uploaded.",
    ]);
  });

  it("ignores code: classes, keys, enums, paths, t() keys, comparisons, marked literals", () => {
    expect(
      scan(`
        import x from "./Some Module";
        const k = t("catalog.list.title");
        const c = <div className="flex items-center gap-2 sm:hidden" id="spec-editor" />;
        if (status === "PUBLISHED" || code === "Not Found") {}
        const p = \`/api/v1/admin/catalog/products/\${id}\`;
        const key = "product_master:edit";
        const lang = "en";
        // i18n-ignore: brand line, never translated
        const brand = "Energy in Motion";
        type T = "Some type";
      `),
    ).toEqual([]);
  });
});
