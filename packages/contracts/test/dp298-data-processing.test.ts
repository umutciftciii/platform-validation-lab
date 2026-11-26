// DP-298 (ADR-031): processing purposes, consent states, the legal text markup and the gate.
import { describe, expect, it } from "vitest";
import {
  CONSENT_PURPOSES,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_TEXT_VERSION,
  PRIVACY_POLICY_SECTIONS,
  PROCESSING_PURPOSES,
  SEED_LEGAL_TEXTS,
  aiPurposeReady,
  consentStates,
  legalTextRegistryFrom,
  legalTextsFor,
  policyEvidenceText,
  policyFromMarkup,
  policyToMarkup,
  privacyBlockersFor,
  privacyPublication,
  type LegalTextSet,
} from "../src/index.js";

describe("DP-298 processing purposes", () => {
  it("states GDPR and KVKK bases separately and never mixes the regimes", () => {
    for (const p of Object.values(PROCESSING_PURPOSES)) {
      expect(p.gdpr.basis).toMatch(/^art_6_1_[abcf]_/);
      expect(p.kvkk.basis).toMatch(/^art_5_/);
      expect(p.gdpr.note).not.toMatch(/KVKK|6698/);
      // KVKK applicability to the Dutch controller is a legal review point everywhere.
      expect(p.kvkk.applicability).toBe("legal_review_required");
    }
  });

  it("asks consent only where consent is the basis, and every consent purpose has one", () => {
    for (const p of Object.values(PROCESSING_PURPOSES)) {
      if (p.gdpr.basis === "art_6_1_a_consent") expect(p.consent).not.toBeNull();
    }
    const withConsent = Object.values(PROCESSING_PURPOSES).flatMap((p) =>
      p.consent ? [p.consent] : [],
    );
    expect(new Set(withConsent)).toEqual(new Set(CONSENT_PURPOSES));
    // The forms' core purposes never need consent (no required consent, owner rule).
    for (const id of [
      "customer_communication",
      "quotation",
      "crm_record",
      "sales_management",
    ] as const) {
      expect(PROCESSING_PURPOSES[id].consent).toBeNull();
    }
  });

  it("does not forbid AI categorically, yet no AI purpose with personal data is ready today", () => {
    expect(PROCESSING_PURPOSES.crm_record.aiAllowed).toBe(true);
    expect(PROCESSING_PURPOSES.ai_assisted_processing.active).toBe(false);
    for (const id of Object.keys(PROCESSING_PURPOSES) as (keyof typeof PROCESSING_PURPOSES)[]) {
      expect(aiPurposeReady(id), id).toBe(false);
    }
  });

  it("describes future processing as inactive, never as happening", () => {
    expect(PROCESSING_PURPOSES.international_transfer.active).toBe(false);
    expect(LEGAL_DOCUMENTS.AI_PROCESSING_NOTICE.usedBy).toBeNull();
    expect(LEGAL_DOCUMENTS.INTERNATIONAL_TRANSFER_NOTICE.usedBy).toBeNull();
  });
});

describe("DP-298 consent states", () => {
  it("takes the latest record per purpose; an unknown purpose is never granted", () => {
    const states = consentStates([
      { purpose: "MARKETING_EMAIL", action: "GRANTED", createdAt: "2026-11-01T10:00:00.000Z" },
      { purpose: "MARKETING_EMAIL", action: "WITHDRAWN", createdAt: "2026-11-02T10:00:00.000Z" },
      { purpose: "AI_PERSONAL_DATA", action: "GRANTED", createdAt: "2026-11-03T10:00:00.000Z" },
    ]);
    expect(states.find((s) => s.purpose === "MARKETING_EMAIL")?.state).toBe("WITHDRAWN");
    expect(states.find((s) => s.purpose === "AI_PERSONAL_DATA")?.state).toBe("GRANTED");
    expect(states.find((s) => s.purpose === "INTERNATIONAL_TRANSFER")).toEqual({
      purpose: "INTERNATIONAL_TRANSFER",
      state: null,
      since: null,
    });
  });
});

describe("DP-298 legal texts", () => {
  it("round-trips the privacy policy through the editor markup", () => {
    const markup = policyToMarkup(PRIVACY_POLICY_SECTIONS);
    const back = policyFromMarkup(markup);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.sections).toEqual(PRIVACY_POLICY_SECTIONS.map((s) => ({ ...s })));
      expect(policyEvidenceText(back.sections)).toBe(policyEvidenceText(PRIVACY_POLICY_SECTIONS));
    }
    const nl = SEED_LEGAL_TEXTS["nl"] as LegalTextSet;
    const nlBack = policyFromMarkup(policyToMarkup(nl.privacyPolicy.sections));
    expect(nlBack.ok && nlBack.sections).toEqual(nl.privacyPolicy.sections.map((s) => ({ ...s })));
  });

  it("refuses markup it cannot read (fail closed)", () => {
    expect(policyFromMarkup("Intro without a heading")).toEqual({
      ok: false,
      line: 1,
      rule: "text_before_section",
    });
    expect(policyFromMarkup("## A {#x}\n\ntext\n\n## B {#x}\n\nmore")).toMatchObject({
      ok: false,
      rule: "duplicate_id",
    });
    expect(policyFromMarkup("   \n")).toMatchObject({ ok: false, rule: "empty" });
  });

  it("parses headings, paragraphs and list items", () => {
    const r = policyFromMarkup(
      "## Your rights\n\nYou may ask.\nWe answer.\n\n- access\n- erasure\n\n## Contact",
    );
    expect(r).toEqual({
      ok: true,
      sections: [
        {
          id: "your-rights",
          title: "Your rights",
          paragraphs: ["You may ask. We answer."],
          list: ["access", "erasure"],
        },
        { id: "contact", title: "Contact", paragraphs: [] },
      ],
    });
  });

  it("names versions like the evidence columns accept them", () => {
    for (const v of ["2026-11-27.en", "2026-11-27.2.en", "2026-11-11", "2026-11-23.nl"]) {
      expect(LEGAL_TEXT_VERSION.test(v), v).toBe(true);
    }
    expect(LEGAL_TEXT_VERSION.test("v2")).toBe(false);
    expect(LEGAL_DOCUMENT_KEYS).toHaveLength(8);
  });

  it("builds the registry from published sets only; a missing language is not offered", () => {
    const en = SEED_LEGAL_TEXTS["en"] as LegalTextSet;
    const registry = legalTextRegistryFrom([
      {
        locale: "en",
        privacyNotice: en.privacyNotice,
        marketingConsent: en.marketingConsent,
        contactNotice: en.contactNotice,
        privacyPolicy: { version: en.privacyPolicy.version, sections: en.privacyPolicy.sections },
        translates: null,
      },
    ]);
    expect(legalTextsFor("en", registry)?.privacyNotice).toEqual(en.privacyNotice);
    expect(legalTextsFor("nl", registry)).toBeNull();
    expect(legalTextsFor("en", {})).toBeNull();
  });

  it("blocks production while a current version waits for legal review or the API is silent", () => {
    const pending = privacyBlockersFor([
      { key: "CONTACT_NOTICE", locale: "en", version: "2026-11-13.en" },
    ]);
    expect(pending).toContain("DP-298: legal review of CONTACT_NOTICE 2026-11-13.en");
    expect(privacyBlockersFor(null)).toContain("DP-298: legal texts unavailable");
    expect(privacyPublication("production", privacyBlockersFor(null)).publish).toBe(false);
    expect(privacyPublication("staging", privacyBlockersFor(null)).publish).toBe(true);
    // The constants' `final` flags no longer count (the review state replaces them).
    expect(privacyBlockersFor([]).some((b) => b.startsWith("D-T3") || b.startsWith("DP-151"))).toBe(
      false,
    );
  });
});

describe("DP-298 legal-text body limit route", () => {
  it("matches the draft create and update routes only", async () => {
    const { LEGAL_TEXT_BODY_PATH } = await import("../src/index.js");
    expect(LEGAL_TEXT_BODY_PATH.test("/api/v1/admin/legal-texts/drafts")).toBe(true);
    expect(
      LEGAL_TEXT_BODY_PATH.test(
        "/api/v1/admin/legal-texts/drafts/0193d2a0-0000-7000-8000-000000000001",
      ),
    ).toBe(true);
    expect(LEGAL_TEXT_BODY_PATH.test("/api/v1/admin/legal-texts/versions/x/publish")).toBe(false);
    expect(LEGAL_TEXT_BODY_PATH.test("/api/v1/admin/legal-texts/drafts/../x")).toBe(false);
  });
});
