// DP-268: the confirmations and short forms of Content, SEO > Redirects, Staff and the owner console
// became modal dialogs, so their EN HTML baselines (fixtures/catalog-en/<file>.json.gz) were recorded
// again. This test proves the move changed markup only, never wording: for every render of those
// four EN tests it compares the visible text and the accessible names (aria-label, title,
// placeholder, alt) with the ML-12e recording kept in fixtures/dp268-en/<file>.json.gz.
// - every text of the old render is still there (as often as before);
// - a text that is new in a render (a dialog title, a trigger that now stays visible) is one the
//   same EN test already showed somewhere before the change: no new or changed wording.
import { readFileSync } from "node:fs";
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
  "&nbsp;": " ",
};
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m]!);

/** Visible text runs and accessible-name attribute values of one render. */
export function texts(html: string): string[] {
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

/** Owner module switch renders where the API asked for a step-up (owner-en). */
const STEP_UP = /^Module switch states \(EN\) > asks for the authenticator \(step-up\)/;
/** The reason form's texts, replaced in the dialog by the step-up step. */
const REASON_STEP = ["Change CRM", "Reason", "Recorded in the protected audit trail.", "Cancel"];

/** A text without the attribute prefix, so a heading may repeat an aria-label's words. */
const words = (x: string) => x.replace(/^@[a-z-]+=/, "");

describe("DP-268: the dialogs keep every EN text (no new or changed wording)", () => {
  for (const file of FILES) {
    it(file, () => {
      const before = load("dp268-en", file);
      const after = load("catalog-en", file);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      const known = new Set(Object.values(before).flatMap((h) => texts(h).map(words)));
      let changed = 0;
      for (const key of Object.keys(before)) {
        // An aria-label that became the dialog's visible title keeps its words: compare words.
        const old = count(texts(before[key]!).map(words));
        const now = count(texts(after[key]!).map(words));
        if (STEP_UP.test(key)) {
          // While the authenticator code is asked, the dialog shows that step instead of the
          // reason form (the reason stays typed in); the step-up texts themselves must be there.
          for (const t of REASON_STEP) old.set(t, Math.max(0, (old.get(t) ?? 0) - 1));
        }
        const lost = [...old].filter(([t, n]) => (now.get(t) ?? 0) < n).map(([t]) => t);
        const added = [...now].filter(([t, n]) => n > (old.get(t) ?? 0)).map(([t]) => t);
        expect(lost, `text lost in "${key}"`).toEqual([]);
        expect(
          added.filter((t) => !known.has(words(t))),
          `new wording in "${key}"`,
        ).toEqual([]);
        if (before[key] !== after[key]) changed += 1;
      }
      expect(changed).toBeGreaterThan(0);
    });
  }
});
