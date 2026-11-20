// ML-6 (DP-138, ADR-028 D11): the site UI dictionaries and the locale formats of the BV site.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COUNTRY_CODES, XREF_PUBLIC_LABELS, xrefPublicNotice } from "@dream/contracts";

import { EN_BEFORE_ML6 } from "./en.snapshot.ts";
import { en } from "./en.ts";
import {
  contactFormUi,
  countryOptions,
  dictionary,
  formatDate,
  formatNumber,
  formatRelative,
  formatTime,
  interpolate,
  intlLocale,
  leadFormUi,
  parts,
  placeholders,
  plural,
} from "./index.ts";
import { nl } from "./nl.ts";

/** Every leaf of a dictionary as `path → value`. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

const EN = flatten(en);
const NL = flatten(nl);

/**
 * Dutch values that are rightly the same as English: brand and legal names, codes, and words both
 * languages write alike. Anything else identical to English is an untranslated string.
 */
const SAME_IN_DUTCH = new Set([
  "common.home",
  "common.contact",
  "common.website",
  "meta.articleRemoved",
  "meta.productFallback",
  "shell.copyright",
  "catalogue.eyebrow",
  "catalogue.count.one",
  "catalogue.inCategory",
  "catalogue.categoryCard",
  "documents.type.OTHER",
  "contactSection.email",
  "privacy.eyebrow",
  "leadForm.privacyLegend",
]);

describe("EN dictionary", () => {
  it("keeps every English text of the site word for word (frozen before ML-6)", () => {
    assert.deepEqual(EN, EN_BEFORE_ML6);
  });

  it("uses the approved cross-reference texts of @dream/contracts (one source)", () => {
    assert.equal(en.crossReferences.verified, XREF_PUBLIC_LABELS.VERIFIED);
    assert.equal(en.crossReferences.similar, XREF_PUBLIC_LABELS.SIMILAR);
    assert.equal(interpolate(en.crossReferences.notice, { company: "Dream Petroleum BV" }), xrefPublicNotice("Dream Petroleum BV"));
  });

  it("has no empty value", () => {
    for (const [key, value] of Object.entries(EN)) assert.ok(value.trim() !== "", key);
  });
});

describe("NL dictionary", () => {
  it("has exactly the English keys (complete, nothing extra)", () => {
    assert.deepEqual(Object.keys(NL).sort(), Object.keys(EN).sort());
  });

  it("has no empty value", () => {
    for (const [key, value] of Object.entries(NL)) assert.ok(value.trim() !== "", key);
  });

  it("uses the same placeholders as English in every value", () => {
    for (const key of Object.keys(EN)) {
      assert.deepEqual(
        [...new Set(placeholders(NL[key] as string))].sort(),
        [...new Set(placeholders(EN[key] as string))].sort(),
        key,
      );
    }
  });

  it("translates every value except the known same-in-both ones", () => {
    const untranslated = Object.keys(EN).filter((k) => NL[k] === EN[k] && !SAME_IN_DUTCH.has(k));
    assert.deepEqual(untranslated, []);
    // The allowlist names only keys that exist and are really the same.
    for (const k of SAME_IN_DUTCH) assert.equal(NL[k], EN[k], k);
  });

  it("never translates brand names, product codes, units and standards", () => {
    for (const [key, value] of Object.entries(EN)) {
      for (const term of ["Dream Petroleum BV", "ICCSYN", "CTL", "PDF", "MB", "KB", "TDS", "SDS"]) {
        if (!value.includes(term)) continue;
        const dutch = NL[key] as string;
        // "PDF" is written lower case in running Dutch text ("pdf", "Pdf downloaden").
        const found = term === "PDF" ? /pdf/i.test(dutch) : dutch.includes(term);
        assert.ok(found, `${key}: "${term}" must stay in the Dutch text`);
      }
    }
  });

  it("is what dictionary('nl') returns; any other language falls back to English", () => {
    assert.equal(dictionary("nl"), nl);
    assert.equal(dictionary("en"), en);
    assert.equal(dictionary("tr"), en);
  });
});

describe("interpolate and parts", () => {
  it("fills placeholders once and leaves unknown ones visible", () => {
    assert.equal(interpolate("{a} and {b}", { a: 1, b: "x" }), "1 and x");
    assert.equal(interpolate("{a} and {missing}", { a: 1 }), "1 and {missing}");
    // A value is inserted as is, never read as a template again.
    assert.equal(interpolate("Search: {q}", { q: "{q} {count}" }), "Search: {q} {count}");
  });

  it("splits a template around values that carry markup", () => {
    const LINK = { link: true };
    assert.deepEqual(parts("Try another word or {clear}.", { clear: LINK }), ["Try another word or ", LINK, "."]);
    assert.deepEqual(parts("{a}{b}", { a: 1, b: 2 }), [1, 2]);
  });
});

describe("plural (CLDR rules)", () => {
  it("English and Dutch: one for 1, other for 0 and 2+", () => {
    const forms = en.catalogue.count;
    assert.equal(plural("en", forms, 1), "1 product");
    assert.equal(plural("en", forms, 0), "0 products");
    assert.equal(plural("en", forms, 24), "24 products");
    assert.equal(plural("nl", nl.catalogue.count, 1), "1 product");
    assert.equal(plural("nl", nl.catalogue.count, 2), "2 producten");
    assert.equal(plural("nl", nl.documents.pages, 1), "1 pagina");
    assert.equal(plural("nl", nl.documents.pages, 12), "12 pagina's");
  });

  it("form messages keep their English wording", () => {
    assert.equal(plural("en", en.leadForm.tooMany, 1), "Too many requests. Please try again in about 1 minute.");
    assert.equal(plural("en", en.contactForm.tooMany, 3), "Too many messages. Please try again in about 3 minutes.");
    assert.equal(plural("nl", nl.leadForm.tooMany, 3), "Te veel aanvragen. Probeer het over ongeveer 3 minuten opnieuw.");
  });
});

describe("locale formats (en-GB / nl-NL, Europe/Amsterdam)", () => {
  it("maps the site languages to their formats", () => {
    assert.equal(intlLocale("en"), "en-GB");
    assert.equal(intlLocale("nl"), "nl-NL");
    assert.equal(intlLocale("xx"), "en-GB");
  });

  it("writes numbers with the locale's separators", () => {
    assert.equal(formatNumber("en", 1800.5), "1,800.5");
    assert.equal(formatNumber("nl", 1800.5), "1.800,5");
    assert.equal(formatNumber("nl", 6.1), "6,1");
    assert.equal(formatNumber("nl", 1.44, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), "1,4");
  });

  it("writes dates in Europe/Amsterdam (an evening in UTC is the next day there)", () => {
    assert.equal(formatDate("en", "2026-11-20T23:30:00Z"), "21 November 2026");
    assert.equal(formatDate("nl", "2026-11-20T23:30:00Z"), "21 november 2026");
    assert.equal(formatTime("nl", "2026-07-01T12:05:00Z"), "14:05");
    assert.equal(formatTime("en", "2026-01-01T12:05:00Z"), "13:05");
  });

  it("writes relative times", () => {
    assert.equal(formatRelative("en", 3, "minute"), "in 3 minutes");
    assert.equal(formatRelative("nl", 3, "minute"), "over 3 minuten");
    assert.equal(formatRelative("nl", -1, "day"), "1 dag geleden");
  });

  it("names countries in the page's language, sorted by its collation; the value stays the ISO code", () => {
    const enList = countryOptions("en", COUNTRY_CODES);
    const nlList = countryOptions("nl", COUNTRY_CODES);
    assert.equal(enList.length, COUNTRY_CODES.length);
    assert.deepEqual(new Set(nlList.map((c) => c.code)), new Set(COUNTRY_CODES));
    const name = (list: { code: string; name: string }[], code: string) => list.find((c) => c.code === code)?.name;
    assert.equal(name(enList, "NL"), "Netherlands");
    assert.equal(name(nlList, "NL"), "Nederland");
    assert.equal(name(nlList, "DE"), "Duitsland");
    assert.equal(name(nlList, "BE"), "België");
    // English keeps the names it showed before ML-6 (`en`, not `en-GB`: "St. Lucia").
    if (COUNTRY_CODES.includes("LC" as (typeof COUNTRY_CODES)[number])) assert.equal(name(enList, "LC"), "St. Lucia");
    const sorted = (list: { name: string }[], tag: string) =>
      list.every((c, i) => i === 0 || (list[i - 1] as { name: string }).name.localeCompare(c.name, tag) <= 0);
    assert.ok(sorted(enList, "en"));
    assert.ok(sorted(nlList, "nl-NL"));
  });
});

describe("form words (client props)", () => {
  it("are plain strings, so they cross the server/client boundary", () => {
    for (const locale of ["en", "nl"]) {
      for (const ui of [leadFormUi(locale), contactFormUi(locale)]) {
        const json = JSON.parse(JSON.stringify(ui));
        assert.deepEqual(json, ui);
      }
    }
  });

  it("carry the shared words of the language", () => {
    assert.equal(leadFormUi("nl").select, "Selecteer…");
    assert.equal(contactFormUi("en").sending, "Sending…");
    assert.equal(contactFormUi("nl").readPrivacyPolicy, nl.common.readPrivacyPolicy);
  });
});
