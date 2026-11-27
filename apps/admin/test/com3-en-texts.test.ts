// COM-3: the English renders of Content changed only where approved.
//
// content-en was recorded again with COM3_RECORD_EN=1; the COM-2b recording it replaces is kept in
// fixtures/com3-en. Against it exactly one render changed: the Corporate site's list of routes
// gains the corporate news list heading (`corporate.news-index`), a registry row like the corporate
// home page and portfolio, with "Import into CMS"; nothing else of the list changed. The news list
// of the corporate site (its heading link) is covered by cms-pages-render.test.tsx.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CMS_SITE_REGISTRY } from "@dream/contracts";
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

describe("COM-3: EN renders changed only where approved", () => {
  const before = load("com3-en", "content-en");
  const after = load("catalog-en", "content-en");

  it("changes exactly the corporate route list", () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual([LIST]);
  });

  it("adds only the news list heading's row to the corporate route list", () => {
    const note = CMS_SITE_REGISTRY.find((e) => e.key === "corporate.news-index")!.note;
    const added = (after[LIST]!.match(ROW) ?? []).filter((row) => row.includes(note));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("Import into CMS");
    expect(added[0]).toContain("/news");
    expect(after[LIST]!.replace(added[0]!, "")).toBe(before[LIST]);
  });
});
