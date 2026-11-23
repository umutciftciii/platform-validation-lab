// ML-10 (DP-241; ADR-028 D12, DP-095): which legal texts a form may show per page language, and
// `GET /lead-form/texts[?locale=…]`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEAD_CONTACT_NOTICE,
  LEGAL_TEXTS,
  currentLeadFormTexts,
  type LegalTextRegistry,
} from "@dream/contracts";

import { formLegalTexts, leadFormTextsAnswer } from "./form-texts.ts";
import { privacyPolicyHref } from "./privacy.ts";
import { privacyLocalesOf } from "./proxy-routes.ts";

const APPROVED: LegalTextRegistry = {
  ...LEGAL_TEXTS,
  nl: { ...LEGAL_TEXTS["nl"]!, review: "approved" },
};
const q = (s: string) => new URLSearchParams(s);

describe("formLegalTexts", () => {
  it("English pages always get the English texts (no language list needed)", () => {
    assert.equal(formLegalTexts("en", [])?.contactNotice.version, LEAD_CONTACT_NOTICE.version);
  });

  it("Dutch pages get no form while the Dutch texts are under review, public or not", () => {
    assert.equal(formLegalTexts("nl", []), null);
    assert.equal(formLegalTexts("nl", ["en", "nl"]), null);
  });

  it("an approved Dutch translation needs NL public too (fail closed)", () => {
    assert.equal(formLegalTexts("nl", ["en"], APPROVED), null);
    assert.equal(formLegalTexts("nl", ["en", "nl"], APPROVED)?.privacyNotice.version, "2026-11-23.nl");
  });

  it("other values are no language", () => {
    for (const l of ["de", "EN", "", "constructor"]) assert.equal(formLegalTexts(l, ["en", "nl", l]), null);
  });
});

describe("GET /lead-form/texts", () => {
  it("without a language answers the English texts exactly as before ML-10", () => {
    assert.deepEqual(leadFormTextsAnswer(q(""), []), { status: 200, body: currentLeadFormTexts() });
    assert.deepEqual(leadFormTextsAnswer(q("locale=en"), []), { status: 200, body: currentLeadFormTexts() });
  });

  it("never serves the Dutch drafts", () => {
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en", "nl"]), { status: 404 });
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en"]), { status: 404 });
    const body = JSON.stringify(leadFormTextsAnswer(q("locale=nl"), ["en", "nl"]));
    assert.ok(!body.includes(LEGAL_TEXTS["nl"]!.privacyNotice.text.slice(0, 30)));
  });

  it("serves an approved, public language with its own versions", () => {
    const a = leadFormTextsAnswer(q("locale=nl"), ["en", "nl"], APPROVED);
    assert.equal(a.status, 200);
    assert.equal(a.status === 200 && a.body.privacyNotice.version, "2026-11-23.nl");
    assert.deepEqual(leadFormTextsAnswer(q("locale=nl"), ["en"], APPROVED), { status: 404 });
  });

  it("refuses odd queries (several values, unknown or malformed languages)", () => {
    for (const s of ["locale=en&locale=nl", "locale=", "locale=EN", "locale=de", "locale=en-GB"]) {
      assert.deepEqual(leadFormTextsAnswer(q(s), ["en", "nl"]), { status: 404 }, s);
    }
  });
});

describe("privacy links of the forms", () => {
  it("point at the policy of a language that has one (English while Dutch is under review)", () => {
    assert.equal(privacyPolicyHref("en"), "/en/privacy");
    assert.equal(privacyPolicyHref("nl"), "/en/privacy");
  });

  it("an approved Dutch form links the Dutch policy (isolated registry)", () => {
    const locales = privacyLocalesOf(APPROVED);
    assert.equal(privacyPolicyHref("nl", locales), "/nl/privacy");
    assert.equal(privacyPolicyHref("en", locales), "/en/privacy");
  });
});
