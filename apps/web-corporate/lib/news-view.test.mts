import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NEWS_PAGE_SIZE, formatNewsDate, newsPage, newsPageHref } from "./news-view.ts";

const list = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("news list pages (COM-3)", () => {
  it("shows 12 articles a page, the first page without a parameter", () => {
    assert.equal(NEWS_PAGE_SIZE, 12);
    const first = newsPage(list(19), undefined);
    assert.deepEqual(first, { items: list(12), page: 1, pages: 2 });
    assert.deepEqual(newsPage(list(19), "2"), {
      items: [13, 14, 15, 16, 17, 18, 19],
      page: 2,
      pages: 2,
    });
  });

  it("has room for the 38 articles of the live site (19 per language) and more", () => {
    assert.equal(newsPage(list(38), undefined)?.pages, 4);
    assert.deepEqual(newsPage(list(38), "4")?.items, [37, 38]);
  });

  it("is page 1 with no article for an empty list", () => {
    assert.deepEqual(newsPage([], undefined), { items: [], page: 1, pages: 1 });
  });

  it("refuses ?page=1, a page past the last one and anything not a plain number", () => {
    for (const raw of ["1", "3", "0", "-1", "02", "2.0", "x", "", "99999", ["2", "2"]]) {
      assert.equal(newsPage(list(19), raw as string), null, String(raw));
    }
  });

  it("links the pages of a list in its language", () => {
    assert.equal(newsPageHref("/en/news", 1), "/en/news");
    assert.equal(newsPageHref("/tr/news", 3), "/tr/news?page=3");
  });

  it("dates an article in the page's language, Istanbul time", () => {
    assert.equal(formatNewsDate("en", "2026-11-27T22:30:00.000Z"), "28 November 2026");
    assert.equal(formatNewsDate("tr", "2026-11-27T10:00:00.000Z"), "27 Kasım 2026");
  });
});
