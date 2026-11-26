// ML-10 (DP-241; ADR-028 D12, DP-095): which legal texts a form may show per page language, and
// `GET /lead-form/texts[?locale=…]`. DP-298 (ADR-031 D1): the registry is the API's snapshot of
// the published versions; the fixtures are built from the seed texts as the API would list them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEAD_CONTACT_NOTICE,
  SEED_LEGAL_TEXTS,
  currentLeadFormTexts,
  legalTextRegistryFrom,
} from "@dream/contracts";

import { formLegalTexts, leadFormTextsAnswer } from "./form-texts.ts";
import { privacyPolicyHref } from "./privacy.ts";
import { privacyLocalesOf } from "./proxy-routes.ts";

/** Only English is published (the state after the seed migration). */
const ENGLISH = legalTextRegistryFrom([SEED_LEGAL_TEXTS["en"]!]);
/** Dutch published too. */
const DUTCH = legalTextRegistryFrom([SEED_LEGAL_TEXTS["en"]!, SEED_LEGAL_TEXTS["nl"]!]);
const q = (s: string) => new URLSearchParams(s);

describe("formLegalTexts", () => {
  it("English pages always get the English texts (no language list needed)", () => {
    assert.equal(formLegalTexts("en", [], ENGLISH)?.contactNotice.version, LEAD_CONTACT_NOTICE.version);
  });

  it("Dutch pages get no form while no Dutch version is published, public or not", () => {
    assert.equal(formLegalTexts("nl", [], ENGLISH), null);
    assert.equal(formLegalTexts("nl", ["en", "nl"], ENGLISH), null);
  });

  it("a set not offered (the seed's Dutch draft under review) is never used", () => {
    assert.equal(formLegalTexts("nl", ["en", "nl"], SEED_LEGAL_TEXTS), null);
  });

  it("published Dutch texts need NL public too (fail closed)", () => {
    assert.equal(formLegalTexts("nl", ["en"], DUTCH), null);
    assert.equal(formLegalTexts("nl", ["en", "nl"], DUTCH)?.privacyNotice.version, "2026-11-23.nl");
  });

  it("DP-298: no snapshot (empty registry) is no form, English included", () => {
    assert.equal(formLegalTexts("en", [], {}), null);
  });

  it("other values are no language", () => {
    for (const l of ["de", "EN", "", "constructor"]) {
      assert.equal(formLegalTexts(l, ["en", "nl", l], DUTCH), null);
    }
  });
});

describe("GET /lead-form/texts", () => {
  it("without a language answers the English texts exactly as before ML-10", () => {
    assert.deepEqual(leadFormTextsAnswer(q(""), [], ENGLISH), { status: 200, body: currentLeadFormTexts() });
    assert.deepEqual(leadFormTextsAnswer(q("locale=en"), [], ENGLISH), {
      status: 200,
      body: currentLeadFormTexts(),
    });
  });

  it("DP-298: without published English texts (or no snapshot) it is a 404", () => {
    assert.deepEqual(leadFormTextsAnswer(q(""), [], {}), { status: 404 });
    assert.deepEqual(leadFormTextsAnswer(q("locale=en"), [], {}), { status: 404 });
  });

  it("never serves Dutch texts that are not published", () => {
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en", "nl"], ENGLISH), { status: 404 });
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en", "nl"], SEED_LEGAL_TEXTS), { status: 404 });
    const body = JSON.stringify(leadFormTextsAnswer(q("locale=nl"), ["en", "nl"], SEED_LEGAL_TEXTS));
    assert.ok(!body.includes(SEED_LEGAL_TEXTS["nl"]!.privacyNotice.text.slice(0, 30)));
  });

  it("serves a published, public language with its own versions", () => {
    const a = leadFormTextsAnswer(q("locale=nl"), ["en", "nl"], DUTCH);
    assert.equal(a.status, 200);
    assert.equal(a.status === 200 && a.body.privacyNotice.version, "2026-11-23.nl");
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en"], DUTCH), { status: 404 });
  });

  it("refuses odd queries (several values, unknown or malformed languages)", () => {
    for (const s of ["locale=en&locale=nl", "locale=", "locale=EN", "locale=de", "locale=en-GB"]) {
      assert.deepEqual(leadFormTextsAnswer(q(s), ["en", "nl"], DUTCH), { status: 404 }, s);
    }
  });
});

describe("privacy links of the forms", () => {
  it("point at the policy of a language that has one (English while Dutch is not published)", () => {
    const locales = privacyLocalesOf(ENGLISH);
    assert.equal(privacyPolicyHref("en", locales), "/en/privacy");
    assert.equal(privacyPolicyHref("nl", locales), "/en/privacy");
  });

  it("a published Dutch form links the Dutch policy", () => {
    const locales = privacyLocalesOf(DUTCH);
    assert.equal(privacyPolicyHref("nl", locales), "/nl/privacy");
    assert.equal(privacyPolicyHref("en", locales), "/en/privacy");
  });
});
