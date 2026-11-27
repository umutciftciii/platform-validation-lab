// COM-5: the English renders of Content changed only where approved.
//
// content-en was recorded again with COM5_RECORD_EN=1; the COM-4 recording it replaces is kept in
// fixtures/com5-en. Against it exactly four renders changed:
//  - the Corporate site's list of routes gains the 26 rows of the live site's content (seven
//    content pages and 19 news articles), each with "Import into CMS"; nothing else of the list
//    changed;
//  - the three renders of a news article's editor gain the optional "Original date" field
//    (DP-327, a date input); nothing else of the editor changed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CORPORATE_CONTENT_REGISTRY } from "@dream/contracts";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(dir: string, file: string): Record<string, string> {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, `${file}.json.gz`))).toString("utf8"),
  );
}

/** One registry row of the content list. */
const ROW =
  /<li class="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3\.5[^"]*">(?:(?!<\/li>).)*<\/li>/g;
const LIST =
  "content list (EN) > shows another language, the Corporate site and read-only access #2";
const EDITORS = [
  "page editor (EN) > renders every kind of page #5",
  "page editor (EN) > renders every kind of page #6",
  "page editor (EN) > renders read-only pages and the load error #3",
];
/** The original date field of the article editor (label, date input and hint). */
const DATE_FIELD = /<div><label for="article-originalDate".*?<\/p><\/div>/s;

describe("COM-5: EN renders changed only where approved", () => {
  const before = load("com5-en", "content-en");
  const after = load("catalog-en", "content-en");

  it("changes exactly the corporate route list and the article editors", () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(changed.sort()).toEqual([LIST, ...EDITORS].sort());
  });

  it("adds only the 26 rows of the live site's content to the corporate route list", () => {
    const rows = after[LIST]!.match(ROW) ?? [];
    const added = rows.filter((row) => !before[LIST]!.includes(row));
    expect(added).toHaveLength(26);
    for (const e of CORPORATE_CONTENT_REGISTRY) {
      const row = added.find((r) => r.includes(`>${e.path}<`));
      expect(row, e.key).toBeDefined();
      expect(row).toContain("Import into CMS");
    }
    let rest = after[LIST]!;
    for (const row of added) rest = rest.replace(row, "");
    expect(rest).toBe(before[LIST]);
  });

  it("adds only the optional original date to the article editor", () => {
    for (const k of EDITORS) {
      expect(before[k], k).not.toContain("originalDate");
      const field = after[k]!.match(DATE_FIELD)?.[0] ?? "";
      expect(field).toContain("Original date (optional)");
      expect(field).toContain('type="date"');
      expect(after[k]!.replace(DATE_FIELD, "")).toBe(before[k]);
    }
  });
});
