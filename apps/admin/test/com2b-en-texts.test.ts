// COM-2b: the English renders of Content changed only where approved.
//
// content-en was recorded again with COM2B_RECORD_EN=1; the COM-1 recording it replaces is kept in
// fixtures/com2b-en. Against it exactly two renders changed:
//  - the Corporate site's list of routes gains the product portfolio (`corporate.products`), a
//    registry row like the corporate fragments, with "Import into CMS"; nothing else of the list
//    changed (the fixtures' corporate home page is imported already, so its row is not listed);
//  - the editor of the corporate home page (`corporate.home`) shows its field form instead of the
//    note that the page has no form yet ("Skeleton today…"): the fields of the hero, company
//    overview, services, product groups, strengths and call to action. No field for a counter,
//    a testimonial or a FAQ is in it.
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
const EDITOR = "page editor (EN) > renders every kind of page #9";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("COM-2b: EN renders changed only where approved", () => {
  const before = load("com2b-en", "content-en");
  // COM-3 recorded content-en again; the COM-2b recording is kept in fixtures/com3-en.
  const after = load("com3-en", "content-en");

  it("changes exactly the corporate route list and the corporate home page's editor", () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(changed.sort()).toEqual([LIST, EDITOR].sort());
  });

  it("adds only the portfolio's row to the corporate route list", () => {
    const note = CMS_SITE_REGISTRY.find((e) => e.key === "corporate.products")!.note;
    const added = (after[LIST]!.match(ROW) ?? []).filter((row) => row.includes(note));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("Import into CMS");
    expect(added[0]).toContain("/products");
    expect(after[LIST]!.replace(added[0]!, "")).toBe(before[LIST]);
  });

  it("shows the home page's field form instead of the 'no form yet' note", () => {
    expect(text(before[EDITOR]!)).toContain("Skeleton today.");
    const now = text(after[EDITOR]!);
    expect(now).not.toContain("Skeleton today.");
    expect(now).not.toContain("Its fields get their own form when the page is imported");
    for (const label of [
      "Hero",
      "Company overview",
      "Services",
      "Product groups",
      "Strengths",
      "Call to action",
    ])
      expect(now, label).toContain(label);
    // No field (labels are capitalised; the strengths' hint names counters to rule them out).
    expect(now).not.toMatch(/Counter|Testimonial|FAQ|Frequently|Question/);
    // The frame of the editor before the form is unchanged.
    const head = (html: string) => html.slice(0, html.indexOf("Designed page") + 200);
    expect(text(head(after[EDITOR]!)).slice(0, 80)).toBe(text(head(before[EDITOR]!)).slice(0, 80));
  });
});
