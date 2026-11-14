// DP-163: static catalogue art never overrides a product's own image; samples match by code.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CATEGORY_ART, PRODUCT_SAMPLES, cardImage, categoryArt } from "./catalog-visuals.ts";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const cover = { id: "0190a8c4-7c1e-7000-8000-000000000001", altText: "Drum", width: 1080, height: 1080 };

describe("catalog visuals", () => {
  it("has art for the eight top-level categories, and every file exists", () => {
    assert.deepEqual(Object.keys(CATEGORY_ART).sort(), [
      "base-oil",
      "lubrication-oil",
      "rubber-filled-with-oil-agent",
      "solvent-oil",
      "sustainable-aviation-fuel",
      "transformer-oil",
      "vaseline",
      "white-oil",
    ]);
    for (const src of [...Object.values(CATEGORY_ART), ...Object.values(PRODUCT_SAMPLES)]) {
      assert.ok(existsSync(path.join(PUBLIC, src)), src);
    }
    assert.equal(categoryArt("grease"), null);
    assert.equal(categoryArt("constructor"), null);
  });

  it("keeps the product's own cover; a sample only fills a missing cover", () => {
    assert.deepEqual(cardImage({ code: "G1-SN150", cover }), { kind: "cover", id: cover.id, altText: "Drum" });
    assert.deepEqual(cardImage({ code: "G1-SN150", cover: null }), {
      kind: "sample",
      src: "/media/catalog/product-samples/g1-sn150.webp",
    });
    assert.deepEqual(cardImage({ code: "WO-W1-30", cover: null }), { kind: "none" });
  });

  it("matches samples by exact code: ICCSYN-6-G3 and ICCSYN-6-G3P stay apart", () => {
    const g3 = cardImage({ code: "ICCSYN-6-G3", cover: null });
    const g3p = cardImage({ code: "ICCSYN-6-G3P", cover: null });
    assert.notDeepEqual(g3, g3p);
    assert.deepEqual(cardImage({ code: "ICCSYN-6", cover: null }), { kind: "none" });
    assert.deepEqual(cardImage({ code: "iccsyn-6-g3", cover: null }), { kind: "none" });
  });
});
