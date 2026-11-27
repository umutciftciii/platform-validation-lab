// COM-1: the corporate interface texts exist in both languages with the same keys.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dictionary } from "./i18n.ts";
import { ROUTE_LOCALES } from "./locale-routing.ts";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("dictionary", () => {
  it("has every key, non-empty, in every route language", () => {
    const en = keys(dictionary("en")).sort();
    for (const locale of ROUTE_LOCALES) {
      const d = dictionary(locale);
      assert.deepEqual(keys(d).sort(), en, locale);
      for (const k of en) {
        const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], d);
        assert.ok(typeof v === "string" && v.trim().length > 0, `${locale} ${k}`);
      }
    }
    assert.notEqual(dictionary("tr").notFound.title, dictionary("en").notFound.title);
  });
});
