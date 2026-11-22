// ML-9 (DP-240, ADR-028 D10): how a page names the language of a technical document.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentLang, documentLanguageName, showsDocumentLanguage } from "./document-language.ts";

describe("document language", () => {
  it("names a language as it names itself", () => {
    assert.equal(documentLanguageName("en"), "English");
    assert.equal(documentLanguageName("nl"), "Nederlands");
    assert.equal(documentLanguageName("de"), "Deutsch");
    assert.equal(documentLanguageName("zz-Unknowntag"), "zz-Unknowntag");
  });

  it("leaves English pages as they were: no label for an English document", () => {
    assert.equal(showsDocumentLanguage("en", "en"), false);
    assert.equal(documentLang("en", "en"), undefined);
  });

  it("labels every document outside English: the English fallback and the Dutch file", () => {
    assert.equal(showsDocumentLanguage("nl", "en"), true);
    assert.equal(showsDocumentLanguage("nl", "nl"), true);
    assert.equal(documentLang("nl", "en"), "en");
    assert.equal(documentLang("nl", "nl"), undefined);
  });

  it("labels a document in another language on an English page", () => {
    assert.equal(showsDocumentLanguage("en", "nl"), true);
    assert.equal(documentLang("en", "nl"), "nl");
  });
});
