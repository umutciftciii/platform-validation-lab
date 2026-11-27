// COM-2a: what the corporate sections add to the CMS content — paragraphs, the site's own images
// only (DP-320), the static map link.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMS_STATIC_ASSETS } from "@dream/contracts";

import {
  corporateImage,
  gradeLayout,
  mapHref,
  opensWithPicture,
  paragraphsOf,
  showsTypicalValues,
  textBlocks,
} from "./section-view.ts";

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

describe("product portfolio (COM-2b)", () => {
  it("hides the typical values table while it has no row (DP-002)", () => {
    assert.equal(showsTypicalValues({ rows: [] }), false);
    assert.equal(showsTypicalValues({ rows: [{ property: "Viscosity Index" }] }), true);
  });

  it("shows bare grade names as a list and described grades as cards", () => {
    assert.equal(gradeLayout([]), "none");
    assert.equal(gradeLayout([{ type: null, description: null }]), "chips");
    assert.equal(gradeLayout([{ type: "Aliphatic", description: null }]), "cards");
    assert.equal(gradeLayout([{ type: null, description: "Light grade." }]), "cards");
  });
});

describe("textBlocks (COM-7)", () => {
  it("turns the live site's bullet lines into a list, other paragraphs stay text", () => {
    assert.deepEqual(textBlocks("Intro text.\n\n• One\n• Two"), [
      { kind: "p", text: "Intro text." },
      { kind: "list", items: ["One", "Two"] },
    ]);
    assert.deepEqual(textBlocks("Mixed\n• line"), [{ kind: "p", text: "Mixed\n• line" }]);
    assert.deepEqual(textBlocks(null), []);
  });
});

describe("opensWithPicture (COM-7)", () => {
  const corporate = CMS_STATIC_ASSETS.find((a) => a.site === "CORPORATE")!;
  const bv = CMS_STATIC_ASSETS.find((a) => a.site === "BV" && a.kind === "image")!;
  it("only a first hero with a registered corporate picture", () => {
    assert.equal(opensWithPicture([{ type: "hero", image: corporate.src }]), true);
    assert.equal(opensWithPicture([{ type: "hero", image: bv.src }]), false);
    assert.equal(opensWithPicture([{ type: "hero", image: null }, { type: "hero" }]), false);
    assert.equal(
      opensWithPicture([{ type: "text" }, { type: "hero", image: corporate.src }]),
      false,
    );
    assert.equal(opensWithPicture([]), false);
  });
});
