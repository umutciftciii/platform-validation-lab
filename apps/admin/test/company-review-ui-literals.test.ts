// ML-12b (DP-243) static check of the Company Review area (see support/ui-literals.ts), as ML-12a
// did for Products/Catalog:
//   1. no user-visible English text is written in code any more — it lives in the dictionary;
//   2. every text the area showed before ML-12b (recorded on private main 7b543f6 with
//      ML12B_RECORD_EN=1 in fixtures/company-review-en/ui-literals.json) is still in the English
//      dictionary, word for word — including messages no render test reaches (errors,
//      confirmations, validation, toasts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { listFiles, scanFiles } from "./support/ui-literals";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "test", "fixtures", "company-review-en", "ui-literals.json");
const RECORD = process.env["ML12B_RECORD_EN"] === "1";

/**
 * The Company Review area of ML-12b: its two pages, the review components (also used by the
 * product page: the research notes on the Technical tab) and their view models.
 */
export const REVIEW_SCOPE = [
  "app/(console)/company-review",
  "components/catalog/proposal-decision.tsx",
  "components/catalog/proposal-editor.tsx",
  "components/catalog/proposal-review.tsx",
  "components/catalog/review-tabs.tsx",
  "lib/proposal-edit.ts",
  "lib/proposals-view.ts",
  "lib/review-tabs.ts",
] as const;

/**
 * Literals the baseline scan recorded that were never UI text: the company's time zone (now the
 * shared ADMIN_TIME_ZONE) and a programming error that is thrown, never shown (`i18n-ignore`).
 */
const NOT_UI_IN_BASELINE = new Set(["Europe/Amsterdam", "unknown review section"]);

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

describe("Company Review: no hard-coded UI text (ML-12b)", () => {
  const files = listFiles(ROOT, REVIEW_SCOPE);

  it("scans the whole area", () => {
    expect(files.length).toBe(9);
  });

  it("records the English UI text of the area (baseline, private main 7b543f6)", () => {
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

  it.skipIf(RECORD)("keeps every English text of before ML-12b in the dictionary", () => {
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
