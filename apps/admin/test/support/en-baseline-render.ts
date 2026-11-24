// ML-12a (DP-243) EN regression for the Products/Catalog screens. The catalogue render tests import
// `renderToStaticMarkup` from here instead of react-dom/server: every render of those tests is the
// real React output, and is ALSO compared with the HTML recorded on private main 88251eb (before
// ML-12a) in test/fixtures/catalog-en/<test file>.json.gz
// (gzip: the uncompressed HTML is ~5 MB). Set ML12A_RECORD_EN=1 to record.
// ML-12b: the Company Review EN regression (company-review-en.test.tsx) was recorded the same way on
// private main 7b543f6 with ML12B_RECORD_EN=1 (run only that file when recording).
// ML-12c: the Content area (content-en.test.tsx) on private main a7b140f with ML12C_RECORD_EN=1.
// ML-12d: the SEO area (seo-en.test.tsx) on private main fb6687d with ML12D_RECORD_EN=1.
// ML-12e: Leads, Staff, Owner and the Overview (leads-en, staff-en, owner-en, dashboard-en .test.tsx)
// on private main 10dec17 with ML12E_RECORD_EN=1.
//
// The only difference removed before comparing is React's `<!-- -->` separator between adjacent
// text nodes: a sentence that was "text {value}" in JSX is one translated string now.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup as reactRender } from "react-dom/server";
import { afterAll, expect } from "vitest";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "catalog-en");
const RECORD =
  process.env["ML12A_RECORD_EN"] === "1" ||
  process.env["ML12B_RECORD_EN"] === "1" ||
  process.env["ML12C_RECORD_EN"] === "1" ||
  process.env["ML12D_RECORD_EN"] === "1" ||
  process.env["ML12E_RECORD_EN"] === "1";

export function normalizeEn(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

const recorded = new Map<string, Record<string, string>>();
const counters = new Map<string, number>();
let loaded: { file: string; data: Record<string, string> } | null = null;

function fixtureFile(testPath: string): string {
  return path.join(DIR, `${path.basename(testPath).replace(/\.test\.tsx?$/, "")}.json.gz`);
}

afterAll(() => {
  if (!RECORD) return;
  mkdirSync(DIR, { recursive: true });
  for (const [file, data] of recorded)
    writeFileSync(file, gzipSync(`${JSON.stringify(data, null, 1)}\n`, { level: 9 }));
});

export function renderToStaticMarkup(node: ReactNode): string {
  const html = reactRender(node);
  const state = expect.getState();
  const testPath = state.testPath ?? "unknown";
  const name = state.currentTestName ?? "module";
  const n = (counters.get(name) ?? 0) + 1;
  counters.set(name, n);
  const key = `${name} #${n}`;
  const file = fixtureFile(testPath);
  if (RECORD) {
    const data = recorded.get(file) ?? {};
    data[key] = normalizeEn(html);
    recorded.set(file, data);
    return html;
  }
  if (loaded?.file !== file)
    loaded = { file, data: JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) };
  const expected = loaded.data[key];
  expect(expected, `EN baseline missing for "${key}"`).toBeTypeOf("string");
  expect(normalizeEn(html), `EN render changed: "${key}"`).toBe(expected);
  return html;
}
