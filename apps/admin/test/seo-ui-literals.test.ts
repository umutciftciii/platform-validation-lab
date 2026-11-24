// ML-12d (DP-243) static check of the SEO area (see support/ui-literals.ts), as ML-12a/b/c did
// for Products/Catalog, Company Review and Content:
//   1. no user-visible English text is written in code any more — it lives in the dictionary;
//   2. every text the area showed before ML-12d (recorded on private main fb6687d with
//      ML12D_RECORD_EN=1 in fixtures/seo-en/ui-literals.json, with the ML-12c scanner) is still
//      in the English dictionary, word for word — including messages no render test reaches
//      (API errors, confirmations, toasts, modals).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { listFiles, scanFiles } from "./support/ui-literals";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "test", "fixtures", "seo-en", "ui-literals.json");
const RECORD = process.env["ML12D_RECORD_EN"] === "1";

/**
 * The SEO area of ML-12d: Admin > SEO (overview) and SEO > Redirects, the shared SEO components
 * (tabs, redirect manager; the address summary, SEO fields and preview were translated in ML-12a and
 * stay in scope so nothing English returns) and the view helpers with their messages.
 */
export const SEO_SCOPE = [
  "app/(console)/seo",
  "components/seo",
  "lib/seo-overview.ts",
  "lib/seo-view.ts",
  "lib/seo-server.ts",
  "lib/redirects-view.ts",
  "lib/redirects-client.ts",
] as const;

/**
 * Literals the baseline scan recorded that were never UI text: the company's time zone, the site
 * name of the code defaults (data) and a MIME type.
 */
const NOT_UI_IN_BASELINE = new Set([
  "Europe/Amsterdam",
  "Dream Petroleum BV",
  "text/csv;charset=utf-8",
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

describe("SEO: no hard-coded UI text (ML-12d)", () => {
  const files = listFiles(ROOT, SEO_SCOPE);

  it("scans the whole area", () => {
    expect(files.length).toBe(12);
  });

  it("records the English UI text of the area (baseline, private main fb6687d)", () => {
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

  it.skipIf(RECORD)("keeps every English text of before ML-12d in the dictionary", () => {
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
