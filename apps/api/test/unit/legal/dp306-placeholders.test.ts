/**
 * DP-306 (ADR-031 D1) without a database: placeholder checks on save, the preview the admin shows
 * and the missing values the production gate adds.
 */
import { describe, expect, it } from "vitest";
import { LEAD_CONTACT_NOTICE, PRIVACY_POLICY_SECTIONS, policyToMarkup } from "@dream/contracts";
import { evidenceOf, previewOf } from "../../../src/legal/legal-texts.service.js";
import { publishedTextsFrom, type PublishedRow } from "../../../src/legal/published-texts.js";

const invalidRule = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { details?: { rule: string }[] }).details?.[0]?.rule;
  }
  return null;
};

describe("DP-306 save checks", () => {
  it("refuses unknown and wrong-document placeholders with unknown_placeholder:<name>", () => {
    expect(invalidRule(() => evidenceOf("CONTACT_NOTICE", "Ask {aiProviders}."))).toBe(
      "unknown_placeholder:aiProviders",
    );
    expect(invalidRule(() => evidenceOf("PRIVACY_POLICY", "## A\n\nBy {aiProviders}"))).toBe(
      "unknown_placeholder:aiProviders",
    );
    expect(invalidRule(() => evidenceOf("PRIVACY_POLICY", "## A\n\n- {nonsense}"))).toBe(
      "unknown_placeholder:nonsense",
    );
    expect(invalidRule(() => evidenceOf("PRIVACY_POLICY", "## {transferCountries}\n\nx"))).toBe(
      "unknown_placeholder:transferCountries",
    );
    expect(evidenceOf("AI_PROCESSING_NOTICE", "Providers: {aiProviders}.").text).toBe(
      "Providers: {aiProviders}.",
    );
  });

  it("accepts the seeded policy and notice as they are (hash unchanged)", () => {
    const p = evidenceOf("PRIVACY_POLICY", policyToMarkup(PRIVACY_POLICY_SECTIONS));
    expect(p.sections).toEqual(PRIVACY_POLICY_SECTIONS.map((s) => ({ ...s })));
    expect(evidenceOf("CONTACT_NOTICE", LEAD_CONTACT_NOTICE.text).text).toBe(
      LEAD_CONTACT_NOTICE.text,
    );
  });
});

describe("DP-306 preview", () => {
  it("shows the policy filled, the missing values and the version", () => {
    const text =
      "## Contact {#c}\n\nKVKK: {kvkkContact}. KvK {kvkNumber}. Version {policyVersion}.";
    const draft = previewOf("PRIVACY_POLICY", "en", text, null);
    expect(draft.text).toContain("[pending: KVKK contact (Turkish data protection law)]");
    expect(draft.text).toContain("Version [version assigned on publication]");
    expect(draft.missing.sort()).toEqual(["kvkNumber", "kvkkContact"]);
    expect(draft.publicationProblem).toBeNull();
    expect(previewOf("PRIVACY_POLICY", "en", text, "2026-11-27.en").text).toContain(
      "Version 2026-11-27.en",
    );
    expect(previewOf("PRIVACY_POLICY", "nl", text, null).text).toContain("[nog vast te stellen:");
  });

  it("says why a notice cannot be published yet", () => {
    const p = previewOf("CONTACT_NOTICE", "en", "Write to {privacyEmail}.", null);
    expect(p.missing).toEqual(["privacyEmail"]);
    expect(p.publicationProblem).toBe("missing_value:privacyEmail");
    const ai = previewOf("AI_PROCESSING_NOTICE", "en", "By {aiProviders}.", null);
    expect(ai.missing).toEqual(["aiProviders"]);
    expect(ai.publicationProblem).toBe("missing_value:aiProviders");
    expect(previewOf("CONTACT_NOTICE", "en", LEAD_CONTACT_NOTICE.text, "2026-11-13.en")).toEqual({
      text: LEAD_CONTACT_NOTICE.text,
      placeholders: [],
      missing: [],
      publicationProblem: null,
    });
  });
});

describe("DP-306 production gate", () => {
  let n = 0;
  const row = (p: Partial<PublishedRow> & Pick<PublishedRow, "key" | "version">): PublishedRow => ({
    id: `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
    locale: "en",
    legalReview: "APPROVED",
    text: "t",
    sections: null,
    translatesId: null,
    publishedAt: new Date("2026-11-20T00:00:00Z"),
    ...p,
  });
  const set = (policySections: unknown) => [
    row({ key: "PRIVACY_POLICY", version: "2026-11-20.en", sections: policySections }),
    row({ key: "DOCUMENT_REQUEST_NOTICE", version: "2026-11-20.en" }),
    row({ key: "CONTACT_NOTICE", version: "2026-11-20.en" }),
    row({ key: "MARKETING_CONSENT", version: "2026-11-20.en" }),
  ];

  it("adds a missing value of the current policy that is no blocker of its own", () => {
    const t = publishedTextsFrom(
      set([{ id: "k", title: "KVKK", paragraphs: ["Contact {kvkkContact}"] }]),
    );
    expect(t.missingValues).toEqual([{ locale: "en", placeholder: "kvkkContact" }]);
    expect(t.blockers).toContain("DP-306: missing value {kvkkContact} in PRIVACY_POLICY en");
  });

  it("adds nothing for the seeded policy (its missing values are D-T2/open-point blockers)", () => {
    const t = publishedTextsFrom(set(PRIVACY_POLICY_SECTIONS));
    expect(t.missingValues).toEqual([]);
    expect(t.blockers.some((b) => b.startsWith("D-T2:"))).toBe(true);
  });
});
