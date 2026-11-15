// DP-173: the preview's links mirror the live catalogue's URLs under the preview base, so the
// shared views browse, search, page and show images inside the preview only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browseHref } from "./browse.ts";
import { previewLinks } from "./preview-links.ts";

const BASE = "/preview/catalog/v1.token";

describe("preview links", () => {
  const links = previewLinks(BASE);

  it("builds every list state exactly like the live catalogue, under the preview base", () => {
    for (const p of [
      {},
      { category: "base-oil" },
      { q: "SN 150" },
      { category: "white-oil", q: "W1", page: 3 },
      { page: 1 },
    ]) {
      assert.equal(links.list(p), `${BASE}${browseHref(p)}`);
    }
  });

  it("keeps product pages, the search form and images inside the preview", () => {
    assert.equal(links.product("group-i-base-oil-sn-150"), `${BASE}/products/group-i-base-oil-sn-150`);
    assert.equal(links.searchAction, `${BASE}/products`);
    assert.equal(links.image("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "thumb"), `${BASE}/images/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/thumb`);
    for (const url of [links.list({}), links.product("x"), links.searchAction, links.image("i", "display")]) {
      assert.ok(url.startsWith(`${BASE}/`), url);
      assert.ok(!url.startsWith("/products"), url);
    }
  });
});
