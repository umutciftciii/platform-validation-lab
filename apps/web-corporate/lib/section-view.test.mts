// COM-2a: what the corporate sections add to the CMS content — paragraphs, the site's own images
// only (DP-320), the static map link.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMS_STATIC_ASSETS } from "@dream/contracts";

import { corporateImage, mapHref, paragraphsOf } from "./section-view.ts";

describe("paragraphsOf", () => {
  it("splits plain text at blank lines and drops empty paragraphs", () => {
    assert.deepEqual(paragraphsOf("One\nline\n\n  Two  \n\n\n"), ["One\nline", "Two"]);
    assert.deepEqual(paragraphsOf(null), []);
    assert.deepEqual(paragraphsOf("   "), []);
  });

  it("never turns text into markup", () => {
    assert.deepEqual(paragraphsOf("<b>x</b>"), ["<b>x</b>"]);
  });
});

describe("corporateImage", () => {
  it("never shows a file of the BV site, an unknown path or no image", () => {
    const bv = CMS_STATIC_ASSETS.find((a) => a.site === "BV" && a.kind === "image");
    assert.ok(bv, "the BV site has registered images");
    assert.equal(corporateImage(bv.src), null);
    assert.equal(corporateImage("/media/unknown.webp"), null);
    assert.equal(corporateImage(null), null);
    assert.equal(corporateImage(""), null);
  });

  it("shows a registered image of the corporate site with its stored size", () => {
    for (const a of CMS_STATIC_ASSETS.filter((x) => x.site === "CORPORATE")) {
      const image = corporateImage(a.src);
      if (a.kind === "image") assert.deepEqual(image, a);
      else assert.equal(image, null, "an animation is not a split image");
    }
  });
});

describe("mapHref", () => {
  it("links a map search for the published address (no embed, no tracking)", () => {
    const href = mapHref("Dream Petroleum", [
      { text: "Büyükdere Ave. No:76" },
      { text: "Istanbul" },
    ]);
    assert.ok(href);
    const url = new URL(href);
    assert.equal(url.origin, "https://www.openstreetmap.org");
    assert.equal(url.searchParams.get("query"), "Dream Petroleum, Büyükdere Ave. No:76, Istanbul");
    assert.deepEqual([...url.searchParams.keys()], ["query"]);
  });

  it("has no link without an address", () => {
    assert.equal(mapHref("Dream Petroleum", []), null);
    assert.equal(mapHref("Dream Petroleum", [{ text: "  " }]), null);
  });
});
