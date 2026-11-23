// ML-12c (DP-243) static check of the Content area (see support/ui-literals.ts), as ML-12a/b did
// for Products/Catalog and Company Review:
//   1. no user-visible English text is written in code any more — it lives in the dictionary;
//   2. every text the area showed before ML-12c (recorded on private main a7b140f with
//      ML12C_RECORD_EN=1 in fixtures/content-en/ui-literals.json, with the ML-12c scanner) is still
//      in the English dictionary, word for word — including messages no render test reaches
//      (API errors, confirmations, toasts, modals).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { listFiles, scanFiles } from "./support/ui-literals";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "test", "fixtures", "content-en", "ui-literals.json");
const RECORD = process.env["ML12C_RECORD_EN"] === "1";

/**
 * The Content area of ML-12c: the content pages (pages, news, new page, new article, editor), the
 * CMS components (page editor, menu editors, field form, publication, history, translations,
 * import, site languages) and the CMS client's error texts. The SEO module's own screens
 * (/seo, redirects, seo-tabs, address-summary) are ML-12d; seo-fields and seo-preview were
 * translated in ML-12a.
 */
export const CONTENT_SCOPE = [
  "app/(console)/content",
  "components/cms",
  "lib/cms-client.ts",
] as const;

/**
 * Literals the baseline scan recorded that were never UI text: the company's time zone (now the
 * shared ADMIN_TIME_ZONE), brand names of social networks (data) and field paths of the menu
 * editor's validation issues (codes, marked `i18n-ignore`).
 */
const NOT_UI_IN_BASELINE = new Set([
  "Europe/Amsterdam",
  "Facebook",
  "Instagram",
  "content.noScriptLinks",
  "content.pendingNote",
  "content.contact.addressLines.",
]);

const decode = (s: string) =>
  s
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

const asPattern = (message: string) =>
  new RegExp(
    `^${message
      .split(/\{\w+\}/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*?")}$`,
  );

function englishTexts(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v.replace(/\s+/g, " "));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(en);
  return out;
}

describe("Content: no hard-coded UI text (ML-12c)", () => {
  const files = listFiles(ROOT, CONTENT_SCOPE);

  it("scans the whole area", () => {
    expect(files.length).toBe(19);
  });

  it("records the English UI text of the area (baseline, private main a7b140f)", () => {
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

  it.skipIf(RECORD)("keeps every English text of before ML-12c in the dictionary", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string[]>;
    const messages = englishTexts();
    const dictionary = messages.join("\n");
    const patterns = messages.filter((m) => m.includes("{")).map(asPattern);
    const missing: string[] = [];
    for (const [file, texts] of Object.entries(baseline)) {
      for (const text of texts) {
        for (const raw of text.split("{…}").map((p) => p.trim())) {
          const part = decode(raw);
          if (!/[A-Za-z]{2,}/.test(part) || NOT_UI_IN_BASELINE.has(part)) continue;
          if (!dictionary.includes(part) && !patterns.some((re) => re.test(part)))
            missing.push(`${file}: ${part}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
