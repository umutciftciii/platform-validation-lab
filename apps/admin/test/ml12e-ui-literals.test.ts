// ML-12e (DP-243) static check of the last admin modules — Leads, Staff and access, the owner
// console and the Overview (dashboard) — with the scanner of support/ui-literals.ts, as ML-12a–d did
// for their areas:
//   1. no user-visible English text is written in code any more — it lives in the dictionary;
//   2. every text the areas showed before ML-12e (recorded on private main 10dec17 with
//      ML12E_RECORD_EN=1 in fixtures/ml12e-en/ui-literals.json) is still in the English
//      dictionary, word for word — including messages no render test reaches (API errors,
//      confirmations, toasts, modals).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../lib/i18n/messages/en";
import { listFiles, scanFiles } from "./support/ui-literals";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "test", "fixtures", "ml12e-en", "ui-literals.json");
const RECORD = process.env["ML12E_RECORD_EN"] === "1";

/** The four areas of ML-12e and the files that render their text. */
export const ML12E_SCOPES = {
  leads: [
    "app/(console)/leads",
    "app/(console)/customer-data-access",
    "components/leads",
    "lib/leads-view.ts",
    "lib/leads-client.ts",
  ],
  staff: ["app/(console)/staff", "components/staff", "lib/staff-client.ts"],
  owner: ["app/(console)/owner", "components/owner", "lib/owner-client.ts"],
  dashboard: [
    "app/(console)/page.tsx",
    "app/(console)/error.tsx",
    "app/(console)/loading.tsx",
    "app/(console)/[section]",
    "components/dashboard",
    "lib/demo-data.ts",
  ],
} as const;

/**
 * Literals the baseline scan recorded that were never UI text (data, codes, MIME types). Filled
 * while translating; every entry says why.
 */
const NOT_UI_IN_BASELINE = new Set<string>(["Europe/Amsterdam"]);

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

describe("Leads, Staff, Owner, Overview: no hard-coded UI text (ML-12e)", () => {
  const scopes = Object.entries(ML12E_SCOPES).map(
    ([area, scope]) => [area, listFiles(ROOT, scope)] as const,
  );

  it("scans every area", () => {
    expect(Object.fromEntries(scopes.map(([a, files]) => [a, files.length]))).toEqual({
      leads: 9,
      staff: 3,
      owner: 5,
      dashboard: 11,
    });
  });

  it("records the English UI text of the areas (baseline, private main 10dec17)", () => {
    if (!RECORD) return;
    const byFile: Record<string, string[]> = {};
    for (const [, files] of scopes)
      for (const l of scanFiles(ROOT, files)) (byFile[l.file] ??= []).push(l.text);
    mkdirSync(path.dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(byFile, null, 1)}\n`);
  });

  for (const [area, files] of scopes) {
    it.skipIf(RECORD)(`leaves no English UI text in code: ${area}`, () => {
      const found = scanFiles(ROOT, files).map((l) => `${l.file}:${l.line}  ${l.text}`);
      expect(found).toEqual([]);
    });
  }

  it.skipIf(RECORD)("keeps every English text of before ML-12e in the dictionary", () => {
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
