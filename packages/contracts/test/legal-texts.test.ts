// ML-10 (DP-241; ADR-028 D12, DP-095): the legal texts per language.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEGAL_TEXTS,
  LeadContactMessageInputSchema,
  LeadDocumentRequestInputSchema,
  LeadFormTextsSchema,
  LeadRequestSchema,
  PRIVACY_CONTROLLER,
  PRIVACY_FILL_LABELS_EN,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  currentLeadFormTexts,
  fillPrivacyText,
  leadFormTextsFor,
  legalTextVersionLocale,
  legalTextsFor,
  offeredLegalLocales,
  type LegalTextRegistry,
  type LegalTextSet,
} from "../src/index.js";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** The rule of the database CHECKs on the stored versions (DP-095 migration 20261121090000). */
const DB_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$/;
const placeholders = (t: string) => [...t.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();

const NL = LEGAL_TEXTS["nl"] as LegalTextSet;
const EN = LEGAL_TEXTS["en"] as LegalTextSet;
const APPROVED: LegalTextRegistry = { ...LEGAL_TEXTS, nl: { ...NL, review: "approved" } };

describe("ML-10 English source texts are unchanged", () => {
  it("keeps the versions", () => {
    expect(LEAD_PRIVACY_NOTICE.version).toBe("2026-11-12.en");
    expect(LEAD_MARKETING_CONSENT.version).toBe("2026-11-12.en");
    expect(LEAD_CONTACT_NOTICE.version).toBe("2026-11-13.en");
    expect(PRIVACY_POLICY_VERSION).toBe("2026-11-12.en");
  });

  it("keeps the SHA-256 of every text (prefixes pinned from main c368a21)", () => {
    expect(sha(LEAD_PRIVACY_NOTICE.text).slice(0, 16)).toBe("98b5b050663282f8");
    expect(sha(LEAD_MARKETING_CONSENT.text).slice(0, 16)).toBe("31a4c75fc2f31fc4");
    expect(sha(LEAD_CONTACT_NOTICE.text).slice(0, 16)).toBe("17142526d793fabc");
    expect(sha(JSON.stringify(PRIVACY_POLICY_SECTIONS)).slice(0, 16)).toBe("632c8c6fe35a018f");
  });

  it("the English entry points at the existing constants", () => {
    expect(EN.review).toBe("source");
    expect(EN.translates).toBeNull();
    expect(EN.privacyNotice).toEqual({
      version: LEAD_PRIVACY_NOTICE.version,
      text: LEAD_PRIVACY_NOTICE.text,
    });
    expect(EN.marketingConsent.text).toBe(LEAD_MARKETING_CONSENT.text);
    expect(EN.contactNotice.text).toBe(LEAD_CONTACT_NOTICE.text);
    expect(EN.privacyPolicy.sections).toBe(PRIVACY_POLICY_SECTIONS);
    expect(EN.privacyPolicy.labels).toBe(PRIVACY_FILL_LABELS_EN);
    expect(leadFormTextsFor("en")).toEqual(currentLeadFormTexts());
  });

  it("fills the English policy exactly as before", () => {
    const text = "{legalName}, {registeredAddress}, {dpo}, {processors}";
    expect(fillPrivacyText(text)).toBe(
      "Dream Petroleum B.V., [pending: registered address], [pending: DPO decision], [pending: list of hosting and service providers (processors)]",
    );
    expect(fillPrivacyText("{dpo}", { ...PRIVACY_CONTROLLER, dpo: { required: false } })).toBe(
      "not required for our organisation",
    );
  });
});

describe("ML-10 Dutch translations are drafts (REVIEW REQUIRED)", () => {
  it("are not offered anywhere while under review", () => {
    expect(NL.review).toBe("review_required");
    expect(legalTextsFor("nl")).toBeNull();
    expect(leadFormTextsFor("nl")).toBeNull();
    expect(offeredLegalLocales()).toEqual(["en"]);
  });

  it("fail closed for unknown or odd keys", () => {
    for (const l of ["de", "", "EN", "constructor", "__proto__", "toString"]) {
      expect(legalTextsFor(l)).toBeNull();
    }
    // A set filed under another key is not that language's set.
    expect(legalTextsFor("de", { de: EN })).toBeNull();
  });

  it("have their own versions, valid for the database, naming Dutch", () => {
    for (const v of [NL.privacyNotice, NL.marketingConsent, NL.contactNotice, NL.privacyPolicy]) {
      expect(v.version).toBe("2026-11-23.nl");
      expect(v.version).toMatch(DB_VERSION);
      expect(v.version.length).toBeLessThanOrEqual(20);
      expect(legalTextVersionLocale(v.version)).toBe("nl");
    }
  });

  it("name the current English versions they translate (an English change needs a new review)", () => {
    expect(NL.translates).toEqual({
      privacyNotice: LEAD_PRIVACY_NOTICE.version,
      marketingConsent: LEAD_MARKETING_CONSENT.version,
      contactNotice: LEAD_CONTACT_NOTICE.version,
      privacyPolicy: PRIVACY_POLICY_VERSION,
    });
  });

  it("differ from the English texts, so every language has its own SHA-256", () => {
    expect(sha(NL.privacyNotice.text)).not.toBe(sha(EN.privacyNotice.text));
    expect(sha(NL.marketingConsent.text)).not.toBe(sha(EN.marketingConsent.text));
    expect(sha(NL.contactNotice.text)).not.toBe(sha(EN.contactNotice.text));
  });

  it("have deterministic SHA-256 values (prefixes pinned; any edit is a new version)", () => {
    expect(sha(NL.privacyNotice.text).slice(0, 16)).toBe("bc4cd21c84776891");
    expect(sha(NL.marketingConsent.text).slice(0, 16)).toBe("7eb5f7661e2b28ec");
    expect(sha(NL.contactNotice.text).slice(0, 16)).toBe("1ddc701090c6e912");
    expect(sha(JSON.stringify(NL.privacyPolicy.sections)).slice(0, 16)).toBe("a31fc6ff1ab456e0");
  });

  it("keep the company name, the authority and the facts of the English texts", () => {
    for (const t of [NL.privacyNotice.text, NL.contactNotice.text, NL.marketingConsent.text]) {
      expect(t).toContain("Dream Petroleum B.V.");
    }
    expect(NL.privacyNotice.text).toMatch(/24 maanden/);
    expect(NL.contactNotice.text).toMatch(/24 maanden/);
    expect(NL.privacyNotice.text).toMatch(/gerechtvaardigd belang/);
    expect(NL.marketingConsent.text).toMatch(/^Ja, /);
    expect(NL.marketingConsent.text).toMatch(/intrekken/);
  });

  it("the policy has the same sections, paragraphs, list items and placeholders as English", () => {
    const en = PRIVACY_POLICY_SECTIONS;
    const nl = NL.privacyPolicy.sections;
    expect(nl.map((s) => s.id)).toEqual(en.map((s) => s.id));
    en.forEach((s, i) => {
      const n = nl[i]!;
      expect(n.paragraphs.length).toBe(s.paragraphs.length);
      expect(n.list?.length ?? 0).toBe(s.list?.length ?? 0);
      s.paragraphs.forEach((p, j) =>
        expect(placeholders(n.paragraphs[j]!)).toEqual(placeholders(p)),
      );
      // Numbers (articles, days, months) carry over unchanged.
      const nums = (t: string) => (t.match(/\d+/g) ?? []).sort();
      s.paragraphs.forEach((p, j) => expect(nums(n.paragraphs[j]!)).toEqual(nums(p)));
    });
  });

  it("fills the Dutch policy with Dutch markers and keeps the controller values", () => {
    const labels = NL.privacyPolicy.labels;
    expect(Object.keys(labels.openPoints).sort()).toEqual(
      Object.keys(PRIVACY_FILL_LABELS_EN.openPoints).sort(),
    );
    const out = fillPrivacyText(
      "{legalName} {kvkNumber} {supervisoryAuthority}",
      PRIVACY_CONTROLLER,
      undefined,
      labels,
    );
    expect(out).toBe(
      "Dream Petroleum B.V. [nog vast te stellen: KvK-nummer] Autoriteit Persoonsgegevens",
    );
    expect(
      fillPrivacyText(
        "{dpo}",
        { ...PRIVACY_CONTROLLER, dpo: { required: false } },
        undefined,
        labels,
      ),
    ).toBe("niet vereist voor onze organisatie");
  });
});

describe("ML-10 an approved translation (isolated scenario, never the shipped state)", () => {
  it("is offered with its own texts", () => {
    expect(legalTextsFor("nl", APPROVED)?.locale).toBe("nl");
    expect(offeredLegalLocales(APPROVED)).toEqual(["en", "nl"]);
    const texts = LeadFormTextsSchema.parse(leadFormTextsFor("nl", APPROVED));
    expect(texts.privacyNotice.version).toBe("2026-11-23.nl");
    expect(texts.privacyNotice.text).toBe(NL.privacyNotice.text);
  });
});

describe("ML-10 form language in the contracts", () => {
  const doc = {
    documentId: "0190a5a1-0000-7000-8000-000000000001",
    fullName: "Ada Lovelace",
    company: "Analytical",
    email: "ada@example.com",
    country: "NL",
    privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
    privacyNoticeAccepted: true,
    marketingConsent: false,
    marketingConsentVersion: null,
    website: "",
  };

  it("is optional (older sites send none) and must be a language tag", () => {
    expect(LeadDocumentRequestInputSchema.parse(doc).locale).toBeUndefined();
    expect(LeadDocumentRequestInputSchema.parse({ ...doc, locale: "nl" }).locale).toBe("nl");
    for (const bad of ["NL", "nl_NL", "", "x".repeat(40), 1]) {
      expect(LeadDocumentRequestInputSchema.safeParse({ ...doc, locale: bad }).success).toBe(false);
    }
    const contact = {
      fullName: "Ada Lovelace",
      company: "Analytical",
      email: "ada@example.com",
      country: "NL",
      phone: "",
      subject: "Question",
      message: "A question about grease.",
      privacyNoticeVersion: LEAD_CONTACT_NOTICE.version,
      website: "",
    };
    expect(LeadContactMessageInputSchema.parse(contact).locale).toBeUndefined();
    expect(LeadContactMessageInputSchema.parse({ ...contact, locale: "en" }).locale).toBe("en");
  });

  it("reads a version's language; the pre-suffix archive was English", () => {
    expect(legalTextVersionLocale("2026-11-12.en")).toBe("en");
    expect(legalTextVersionLocale("2026-11-23.nl")).toBe("nl");
    expect(legalTextVersionLocale("2026-11-11")).toBe("en");
  });

  it("an admin answer from an API before ML-10 (no locale) still parses, as null", () => {
    const shape = LeadRequestSchema.shape.locale;
    expect(shape.parse(undefined)).toBeNull();
    expect(shape.parse("nl")).toBe("nl");
  });
});
