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
// DP-268: the confirmations and short forms became modal dialogs (components/dialog.tsx), so the
// HTML of the renders that show one open was recorded again on this branch with DP268_RECORD_EN=1
// (all EN render tests). Their texts are unchanged: test/dp268-en-texts.test.ts compares the
// visible text and accessible names of every render with the ML-12e recording (fixtures/dp268-en).
// ML-14 (DP-271, DP-274): the footer menu editor's heading input got its own id and the dialogs
// got their visual polish, so content-en, owner-en, seo-en and staff-en were recorded again on this
// branch with ML14_RECORD_EN=1. The DP-268 recording they replace is kept in fixtures/ml14-en, and
// test/ml14-en-texts.test.ts allows only the approved wording changes against it.
// DP-270/272/275: the tab names in sentence case (Media & documents, Content review, Missing &
// verification), the menu label marked with its content language (DP-272) and the host of the
// link preview marked lang="en" changed content-en, seo-en, company-review-en,
// company-review-render and product-tabs; they were recorded again with DP275_RECORD_EN=1. The
// ML-14 recording they replace is kept in fixtures/dp275-en, and test/dp275-en-texts.test.ts
// allows only the approved wording changes against it.
// DP-285: the new API error code DATABASE_UNAVAILABLE adds one entry to the Staff client's table of
// every error code (staff-en, "explains every refusal a call can meet"); staff-en was recorded
// again with DP285_RECORD_EN=1 (only that file), and nothing else in it changed.
// DP-298 (ADR-031): a lead's document request labels its notice "Notice acknowledged (information,
// not consent)" instead of "Privacy notice"; leads-en is recorded again with DP298_RECORD_EN=1
// (only that file). The lead page's new Consents panel is not in it (its read answers 404 there).
// COM-1: Admin > SEO shows one site at a time (a site switcher and site-neutral descriptions) and
// Content lists the corporate fragments to import; seo-en and content-en are recorded again with
// COM1_RECORD_EN=1. The recording they replace is kept in fixtures/com1-en, and
// test/com1-en-texts.test.ts allows only the approved changes against it.
// COM-2b: Content lists the corporate home page and the product portfolio to import, and the
// corporate home page has its field form; content-en is recorded again with COM2B_RECORD_EN=1.
// The recording it replaces is kept in fixtures/com2b-en, and test/com2b-en-texts.test.ts allows
// only the approved changes against it.
// COM-3: Content lists the corporate news list heading (`corporate.news-index`) to import;
// content-en is recorded again with COM3_RECORD_EN=1. The recording it replaces is kept in
// fixtures/com3-en, and test/com3-en-texts.test.ts allows only the approved change against it.
// COM-4: Content lists the corporate contact page (`corporate.contact`) to import; content-en is
// recorded again with COM4_RECORD_EN=1. The recording it replaces is kept in fixtures/com4-en,
// and test/com4-en-texts.test.ts allows only the approved change against it.
// COM-5: Content lists the corporate pages and posts of the live site to import, and the article
// editor has the original date field (DP-327); content-en is recorded again with
// COM5_RECORD_EN=1. The recording it replaces is kept in fixtures/com5-en, and
// test/com5-en-texts.test.ts allows only the approved changes against it.
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
  process.env["ML12E_RECORD_EN"] === "1" ||
  process.env["DP268_RECORD_EN"] === "1" ||
  process.env["ML14_RECORD_EN"] === "1" ||
  process.env["DP275_RECORD_EN"] === "1" ||
  process.env["DP285_RECORD_EN"] === "1" ||
  process.env["DP298_RECORD_EN"] === "1" ||
  process.env["COM1_RECORD_EN"] === "1" ||
  process.env["COM2B_RECORD_EN"] === "1" ||
  process.env["COM3_RECORD_EN"] === "1" ||
  process.env["COM4_RECORD_EN"] === "1" ||
  process.env["COM5_RECORD_EN"] === "1";

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
