// COM-7: the English renders of Content changed only where approved.
//
// content-en was recorded again with COM7_RECORD_EN=1; the COM-5 recording it replaces is kept in
// fixtures/com7-en. Against it exactly one render changed, the editor of the corporate home page,
// and only by additions: the activity areas of the opening (an empty list with its hint and "Add
// activity area"), a picture and its alt text for each service card and the call to action, the
// latest news heading (eyebrow, heading, link) and the corporate site's registered pictures as
// the choices of its picture fields. Nothing was removed or reworded.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(dir: string, file: string): Record<string, string> {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, `${file}.json.gz`))).toString("utf8"),
  );
}

const EDITOR = "page editor (EN) > renders every kind of page #9";
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The words of `after` left over once `before` is matched in order (null: not a subsequence). */
function insertions(before: string[], after: string[]): string[] | null {
  const extra: string[] = [];
  let i = 0;
  for (const w of after) {
    if (i < before.length && w === before[i]) i++;
    else extra.push(w);
  }
  return i === before.length ? extra : null;
}

const APPROVED = new Set(
  words(
    [
      "Activity areas (0, 0–4) Shown as tabs over the picture. None: the heading above alone. Add activity area",
      "Image No image A representative scene; never presented as the company&#x27;s own site or fleet. Alt text 0/300",
      "Latest news The three newest published articles are listed under this heading.",
      "Eyebrow (optional) Heading (optional) Link (optional) Label Link /page, #section, https://…, mailto: or tel:",
      "visual-pack-v1/hero-energy-trading.webp visual-pack-v1/hero-logistics-supply.webp",
      "visual-pack-v1/hero-storage-terminal.webp visual-pack-v1/hero-petrochemicals.webp",
    ].join(" "),
  ),
);

describe("COM-7: EN renders changed only where approved", () => {
  const before = load("com7-en", "content-en");
  const after = load("catalog-en", "content-en");

  it("changes exactly the corporate home page's editor", () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(Object.keys(before).filter((k) => after[k] !== before[k])).toEqual([EDITOR]);
  });

  it("only adds the new fields and the corporate pictures to it (nothing removed)", () => {
    const added = insertions(words(before[EDITOR]!), words(after[EDITOR]!));
    expect(added).not.toBeNull();
    expect(added!.filter((w) => !APPROVED.has(w))).toEqual([]);
    for (const text of ["Activity areas", "Add activity area", "Latest news"]) {
      expect(after[EDITOR]).toContain(text);
      expect(before[EDITOR]).not.toContain(text);
    }
  });
});
