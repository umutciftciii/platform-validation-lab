// ML-14: content-en, owner-en, seo-en and staff-en were recorded again (ML14_RECORD_EN=1) after the
// footer menu editor's id fix (DP-271) and the dialog polish (DP-274). This test proves the EN
// wording changed only where the owner approved it, against the DP-268 recording of private main
// a2e9206 kept in fixtures/ml14-en/<file>.json.gz:
// - staff-en: the role-removal dialog's title "Remove <role> from <person>" became the short title
//   "Remove role" and the question "Remove <role> from <person>?" as its text;
// - owner-en: the module reason dialog gained a close (×) button named "Close";
// - every other text and accessible name is unchanged (as often as before), in every render.
// DP-270/272/275 recorded content-en and seo-en again; the ML-14 recording of those two moved to
// fixtures/dp275-en, so this test keeps comparing the two recordings of ML-14 and
// dp275-en-texts.test.ts takes the next step. DP-285 recorded staff-en again (one new error code in
// the Staff client's table); its ML-14 recording moved to fixtures/dp285-en and
// dp285-en-texts.test.ts takes that step.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FILES = ["content-en", "owner-en", "seo-en", "staff-en"] as const;

function load(dir: string, file: string): Record<string, string> {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, `${file}.json.gz`))).toString("utf8"),
  );
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m]!);

/** Visible text runs and accessible-name attribute values of one render. */
function texts(html: string): string[] {
  const out: string[] = [];
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  for (const m of body.matchAll(/\s(aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(`@${m[1]}=${decode(m[2]!)}`);
  for (const run of body.split(/<[^>]*>/)) {
    const t = decode(run).trim();
    if (t) out.push(t);
  }
  return out.sort();
}

function count(list: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

describe("ML-14: the EN wording changes only where approved", () => {
  for (const file of FILES) {
    it(file, () => {
      const before = load("ml14-en", file);
      const after = load(
        ["dp275-en", "dp285-en"].find((d) =>
          existsSync(path.join(FIXTURES, d, `${file}.json.gz`)),
        ) ?? "catalog-en",
        file,
      );
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      let changed = 0;
      for (const key of Object.keys(before)) {
        const old = count(texts(before[key]!));
        const now = count(texts(after[key]!));
        const lost = [...old].flatMap(([t, n]) =>
          Array(Math.max(0, n - (now.get(t) ?? 0))).fill(t),
        );
        const added = [...now].flatMap(([t, n]) =>
          Array(Math.max(0, n - (old.get(t) ?? 0))).fill(t),
        );
        if (lost.length || added.length) changed++;
        const expectedLost: string[] = [];
        const expectedAdded: string[] = [];
        if (file === "staff-en")
          for (const t of lost.filter((x) => /^Remove .+ from .+$/.test(x))) {
            expectedLost.push(t);
            expectedAdded.push("Remove role", `${t}?`);
          }
        if (file === "owner-en")
          for (const t of added.filter((x) => x === "@aria-label=Close")) expectedAdded.push(t);
        expect(lost.sort(), `${file} ${key}: lost`).toEqual(expectedLost.sort());
        expect(added.sort(), `${file} ${key}: added`).toEqual(expectedAdded.sort());
      }
      // The approved changes do show up where the dialogs are open.
      if (file === "staff-en" || file === "owner-en") expect(changed).toBeGreaterThan(0);
      else expect(changed).toBe(0);
    });
  }
});
