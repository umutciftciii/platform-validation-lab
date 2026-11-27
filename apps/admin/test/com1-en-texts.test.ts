// COM-1: the English renders changed only where approved.
//
// seo-en and content-en were recorded again with COM1_RECORD_EN=1; the DP-275 recording they
// replace is kept in fixtures/com1-en. Against it:
//  - seo-en: Admin > SEO shows the chosen site, so the descriptions of the overview and of the
//    redirects name "the chosen site" instead of dreampetroleumbv.com. Nothing else changed (the
//    fixtures hold one site, so no site switcher is shown).
//  - content-en: the Corporate site's list of routes gains its three importable fragments
//    (navigation, footer, SEO defaults), each a registry row like the BV ones. Nothing else changed.
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

function seoApproved(html: string): string {
  return html
    .replaceAll(
      "Search results and link previews of dreampetroleumbv.com:",
      "Search results and link previews of the chosen site:",
    )
    .replaceAll(
      "Old addresses of dreampetroleumbv.com and where they lead.",
      "Old addresses of the chosen site and where they lead.",
    );
}

/** One registry row of the content list, as the corporate fragments render it. */
const ROW =
  /<li class="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3\.5[^"]*">(?:(?!<\/li>).)*<\/li>/g;

describe("COM-1: EN renders changed only where approved", () => {
  it("seo-en: only the two descriptions name the chosen site", () => {
    const before = load("com1-en", "seo-en");
    const after = load("catalog-en", "seo-en");
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    let changed = 0;
    for (const key of Object.keys(before)) {
      expect(after[key], key).toBe(seoApproved(before[key]!));
      if (after[key] !== before[key]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("content-en: only the corporate fragments joined the corporate route list", () => {
    const before = load("com1-en", "content-en");
    const after = load("catalog-en", "content-en");
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const notes = CMS_SITE_REGISTRY.filter((e) =>
      ["corporate.site-nav", "corporate.site-footer", "corporate.site-seo"].includes(e.key),
    ).map((e) => e.note);
    expect(notes).toHaveLength(3);
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual([
      "content list (EN) > shows another language, the Corporate site and read-only access #2",
    ]);
    for (const key of changed) {
      const added = (after[key]!.match(ROW) ?? []).filter((row) =>
        notes.some((n) => row.includes(n)),
      );
      expect(added).toHaveLength(3);
      for (const row of added) expect(row).toContain("Import into CMS");
      let html = after[key]!;
      for (const row of added) html = html.replace(row, "");
      expect(html).toBe(before[key]);
    }
  });
});
