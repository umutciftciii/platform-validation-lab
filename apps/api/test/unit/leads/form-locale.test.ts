// ML-10 (DP-241; ADR-028 D12, DP-095): the form language, its texts and the consent check.
import { describe, expect, it } from "vitest";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEGAL_TEXTS,
  type LegalTextRegistry,
  type LegalTextSet,
} from "@dream/contracts";
import type { ApiConfig } from "../../../src/iam/http/api-config.js";
import { ContactMessagesService } from "../../../src/leads/contact-messages.service.js";
import { LeadRequestsService } from "../../../src/leads/lead-requests.service.js";
import {
  CONTACT_NOTICE_SHA256,
  MARKETING_CONSENT_SHA256,
  PRIVACY_NOTICE_SHA256,
  consentIssue,
  consentVersionProblem,
  contactNoticeIssue,
  contactNoticeVersionProblem,
  evidenceSha256,
  textSha256,
} from "../../../src/leads/consent.js";

const EN = LEGAL_TEXTS["en"] as LegalTextSet;
const NL = LEGAL_TEXTS["nl"] as LegalTextSet;
const APPROVED: LegalTextRegistry = { ...LEGAL_TEXTS, nl: { ...NL, review: "approved" } };
const DOC = "0190f3a0-0000-7000-8000-000000000001";
const docForm = {
  documentId: DOC,
  fullName: "Ada Lovelace",
  company: "Analytical Engines Ltd",
  email: "ada@engines.example",
  country: "NL",
  privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
  privacyNoticeAccepted: true,
  marketingConsent: false,
  marketingConsentVersion: null,
  website: "",
};
const contactForm = {
  fullName: "Ada Lovelace",
  company: "Analytical Engines Ltd",
  email: "ada@engines.example",
  country: "NL",
  phone: "",
  subject: "Grease",
  message: "A question about grease.",
  privacyNoticeVersion: LEAD_CONTACT_NOTICE.version,
  website: "",
};

describe("ML-10 English evidence is unchanged", () => {
  it("same SHA-256 values for the English texts", () => {
    expect(evidenceSha256(EN.privacyNotice.text)).toBe(PRIVACY_NOTICE_SHA256);
    expect(evidenceSha256(EN.marketingConsent.text)).toBe(MARKETING_CONSENT_SHA256);
    expect(evidenceSha256(EN.contactNotice.text)).toBe(CONTACT_NOTICE_SHA256);
    expect(PRIVACY_NOTICE_SHA256).toBe(textSha256(LEAD_PRIVACY_NOTICE.text));
  });

  it("the default (English) checks answer as before", () => {
    expect(consentVersionProblem(docForm)).toBeNull();
    expect(consentIssue({ ...docForm, privacyNoticeVersion: "2026-11-11" })).toEqual({
      path: "privacyNoticeVersion",
      rule: "outdated",
    });
    expect(contactNoticeVersionProblem(contactForm)).toBeNull();
    expect(contactNoticeIssue({ privacyNoticeVersion: "2026-11-12.en" })).toEqual({
      path: "privacyNoticeVersion",
      rule: "outdated",
    });
    // Marketing consent stays optional: an unticked box never checks its version.
    expect(consentIssue({ ...docForm, marketingConsentVersion: "2026-11-23.nl" })).toBeNull();
  });
});

describe("ML-10 language of the texts", () => {
  it("refuses a version of another language (locale_mismatch), never as outdated", () => {
    expect(
      consentIssue({ ...docForm, privacyNoticeVersion: NL.privacyNotice.version }, EN),
    ).toEqual({
      path: "privacyNoticeVersion",
      rule: "locale_mismatch",
    });
    const nl = APPROVED["nl"]!;
    expect(consentIssue(docForm, nl)).toEqual({
      path: "privacyNoticeVersion",
      rule: "locale_mismatch",
    });
    expect(
      consentIssue(
        {
          privacyNoticeVersion: nl.privacyNotice.version,
          marketingConsent: true,
          marketingConsentVersion: LEAD_MARKETING_CONSENT.version,
        },
        nl,
      ),
    ).toEqual({ path: "marketingConsentVersion", rule: "locale_mismatch" });
    expect(contactNoticeIssue(contactForm, nl)).toEqual({
      path: "privacyNoticeVersion",
      rule: "locale_mismatch",
    });
  });

  it("an older version of the same language stays outdated (D-T7)", () => {
    expect(
      consentIssue({ ...docForm, privacyNoticeVersion: "2020-01-01.nl" }, APPROVED["nl"]),
    ).toEqual({
      path: "privacyNoticeVersion",
      rule: "outdated",
    });
  });

  it("accepts the current versions of an approved language, with its own SHA-256", () => {
    const nl = APPROVED["nl"]!;
    expect(
      consentIssue(
        {
          privacyNoticeVersion: nl.privacyNotice.version,
          marketingConsent: true,
          marketingConsentVersion: nl.marketingConsent.version,
        },
        nl,
      ),
    ).toBeNull();
    expect(evidenceSha256(nl.privacyNotice.text)).not.toBe(PRIVACY_NOTICE_SHA256);
    expect(evidenceSha256(nl.privacyNotice.text)).toBe(textSha256(nl.privacyNotice.text));
  });
});

describe("ML-10 the services refuse a form whose texts may not be offered", () => {
  // Stubs that fail the test if the service gets past the language check.
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error("the language check must refuse before anything else runs");
      },
    },
  );
  const config = { deployEnv: "local" } as ApiConfig;
  const docs = (registry?: LegalTextRegistry) =>
    new LeadRequestsService(
      untouched as never,
      untouched as never,
      untouched as never,
      config,
      registry,
    );
  const contact = (registry?: LegalTextRegistry) =>
    new ContactMessagesService(
      untouched as never,
      untouched as never,
      untouched as never,
      config,
      registry,
    );

  it("404 for Dutch while its translation is under review (shipped registry)", async () => {
    const nlDoc = { ...docForm, locale: "nl", privacyNoticeVersion: NL.privacyNotice.version };
    await expect(docs().request({} as never, nlDoc)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const nlMsg = { ...contactForm, locale: "nl", privacyNoticeVersion: NL.contactNotice.version };
    await expect(contact().send({} as never, nlMsg)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("404 for a language without texts", async () => {
    await expect(docs().request({} as never, { ...docForm, locale: "de" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("400 locale_mismatch for English texts on an approved Dutch form, before any database work", async () => {
    await expect(
      docs(APPROVED).request({} as never, { ...docForm, locale: "nl" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "privacyNoticeVersion", rule: "locale_mismatch" }],
    });
    await expect(
      contact(APPROVED).send({} as never, { ...contactForm, locale: "nl" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "privacyNoticeVersion", rule: "locale_mismatch" }],
    });
  });

  it("an English form without a language passes the check (then reaches the site)", async () => {
    await expect(docs().request({} as never, docForm)).rejects.toThrow(
      /language check must refuse/,
    );
    await expect(contact().send({} as never, contactForm)).rejects.toThrow(
      /language check must refuse/,
    );
  });
});
