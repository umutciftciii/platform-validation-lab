// DP-306 (ADR-031 D1): the placeholders of the legal texts — inventory, rules per document,
// filling, publication and the production gate.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_PLACEHOLDERS,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_PLACEHOLDERS,
  PRIVACY_CONTROLLER,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VALUES,
  SEED_LEGAL_TEXTS,
  fillLegalText,
  fillPolicySections,
  fillPrivacyText,
  placeholderProblem,
  placeholdersIn,
  policyMissingValues,
  policyPlaceholderProblem,
  privacyBlockersFor,
  privacyPublication,
  publicationText,
  type LegalDocumentKey,
  type LegalTextSet,
} from "../src/index.js";

/**
 * Every `{name}` token of docs/legal at DP-306 (21): 20 placeholders and `{braces}`, prose of the
 * policy draft's header. Kept here because docs/ is not part of the public export; the guard below
 * checks the files themselves wherever they exist (the private repository).
 */
const DOCS_TOKENS = [
  "privacyEmail",
  "transfers",
  "processors",
  "cookies",
  "transferRecipients",
  "transferCountries",
  "registeredAddress",
  "kvkNumber",
  "dpo",
  "policyVersion",
  "kvkkTransferMechanism",
  "kvkkContact",
  "gdprTransferMechanism",
  "evidenceRetention",
  "customerRecords",
  "backups",
  "aiProviders",
  "transferPurpose",
  "supervisoryAuthority",
  "legalName",
  "braces",
] as const;
const NOT_PLACEHOLDERS = new Set(["braces"]);

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/legal");
/** The CMS text blocks of each draft and the document they become. */
const DRAFT_KEYS: Record<string, LegalDocumentKey[]> = {
  "privacy-policy.draft.md": ["PRIVACY_POLICY"],
  "contact-lead-processing-notice.draft.md": ["CONTACT_NOTICE"],
  "pdf-download-notice.draft.md": ["DOCUMENT_REQUEST_NOTICE"],
  "marketing-consent.draft.md": ["MARKETING_CONSENT"],
  "ai-assisted-processing.draft.md": ["AI_PROCESSING_NOTICE", "AI_PROCESSING_CONSENT"],
  "international-transfer.draft.md": [
    "INTERNATIONAL_TRANSFER_NOTICE",
    "INTERNATIONAL_TRANSFER_CONSENT",
  ],
};
const fenced = (md: string) =>
  [...md.matchAll(/```(?:text|markdown)\n([\s\S]*?)```/g)].map((m) => m[1] as string);

const COMPLETE_CONTROLLER = {
  ...PRIVACY_CONTROLLER,
  registeredAddress: "Example street 1, 1000 AA Amsterdam",
  kvkNumber: "12345678",
  privacyEmail: "privacy@dreampetroleum.example",
  dpo: { required: false } as const,
};
const ALL_VALUES = Object.fromEntries(
  Object.keys(PRIVACY_POLICY_VALUES).map((k) => [k, `value of ${k}`]),
) as unknown as typeof PRIVACY_POLICY_VALUES;

describe("DP-306 placeholder inventory", () => {
  it("knows the 21 tokens of docs/legal: 20 placeholders and one word of prose", () => {
    expect(DOCS_TOKENS).toHaveLength(21);
    const placeholders = DOCS_TOKENS.filter((t) => !NOT_PLACEHOLDERS.has(t));
    expect(new Set(placeholders)).toEqual(new Set(Object.keys(LEGAL_PLACEHOLDERS)));
    expect(Object.keys(LEGAL_PLACEHOLDERS)).toHaveLength(20);
  });

  it("matches the files of docs/legal where they exist (private repository)", (ctx) => {
    if (!existsSync(DOCS)) {
      ctx.skip(); // docs/ is not exported to the public validation repository
      return;
    }
    const found = new Set<string>();
    for (const f of readdirSync(DOCS).filter((n) => n.endsWith(".md"))) {
      for (const t of placeholdersIn(readFileSync(path.join(DOCS, f), "utf8"))) found.add(t);
    }
    expect([...found].sort()).toEqual([...DOCS_TOKENS].sort());
  });

  it("accepts every CMS text block of the drafts for the document it becomes", (ctx) => {
    if (!existsSync(DOCS)) {
      ctx.skip();
      return;
    }
    for (const [file, keys] of Object.entries(DRAFT_KEYS)) {
      const blocks = fenced(readFileSync(path.join(DOCS, file), "utf8"));
      expect(blocks.length, file).toBeGreaterThanOrEqual(keys.length);
      blocks.forEach((block, i) => {
        const key = keys[Math.min(i, keys.length - 1)] as LegalDocumentKey;
        expect(placeholderProblem(key, block), `${file} block ${i}`).toBeNull();
      });
    }
  });

  it("gives every document type an explicit list", () => {
    expect(Object.keys(ALLOWED_PLACEHOLDERS).sort()).toEqual([...LEGAL_DOCUMENT_KEYS].sort());
    for (const list of Object.values(ALLOWED_PLACEHOLDERS)) {
      for (const n of list) expect(Object.hasOwn(LEGAL_PLACEHOLDERS, n), n).toBe(true);
    }
  });
});

describe("DP-306 rules per document", () => {
  it("keeps future AI and transfer placeholders out of the active texts", () => {
    for (const key of [
      "PRIVACY_POLICY",
      "DOCUMENT_REQUEST_NOTICE",
      "CONTACT_NOTICE",
      "MARKETING_CONSENT",
    ] as const) {
      for (const n of [
        "aiProviders",
        "transferRecipients",
        "transferCountries",
        "transferPurpose",
        "gdprTransferMechanism",
        "kvkkTransferMechanism",
      ]) {
        expect(placeholderProblem(key, `x {${n}} y`), `${key} ${n}`).toBe(
          `unknown_placeholder:${n}`,
        );
      }
    }
    expect(placeholderProblem("AI_PROCESSING_NOTICE", "{aiProviders}")).toBeNull();
    expect(placeholderProblem("AI_PROCESSING_NOTICE", "{transferCountries}")).toBe(
      "unknown_placeholder:transferCountries",
    );
    expect(
      placeholderProblem("INTERNATIONAL_TRANSFER_NOTICE", "{gdprTransferMechanism} {transfers}"),
    ).toBeNull();
  });

  it("refuses unknown names and placeholders of another document type", () => {
    expect(placeholderProblem("PRIVACY_POLICY", "{companyName}")).toBe(
      "unknown_placeholder:companyName",
    );
    expect(placeholderProblem("CONTACT_NOTICE", "Version {policyVersion}")).toBe(
      "unknown_placeholder:policyVersion",
    );
    expect(placeholderProblem("MARKETING_CONSENT", "{cookies}")).toBe(
      "unknown_placeholder:cookies",
    );
    expect(
      placeholderProblem("PRIVACY_POLICY", "{policyVersion} {kvkkContact} {cookies}"),
    ).toBeNull();
  });

  it("passes the seeded policies unchanged (English and the Dutch draft)", () => {
    expect(policyPlaceholderProblem(PRIVACY_POLICY_SECTIONS)).toBeNull();
    const nl = SEED_LEGAL_TEXTS["nl"] as LegalTextSet;
    expect(policyPlaceholderProblem(nl.privacyPolicy.sections)).toBeNull();
    for (const set of Object.values(SEED_LEGAL_TEXTS)) {
      for (const [key, t] of [
        ["DOCUMENT_REQUEST_NOTICE", set.privacyNotice.text],
        ["CONTACT_NOTICE", set.contactNotice.text],
        ["MARKETING_CONSENT", set.marketingConsent.text],
      ] as const) {
        expect(placeholdersIn(t), key).toEqual([]);
        expect(publicationText(key, t)).toEqual({ ok: true, text: t });
      }
    }
  });
});

describe("DP-306 filling and publication", () => {
  it("fills the seed policy without a single unresolved placeholder", () => {
    const filled = fillPolicySections(PRIVACY_POLICY_SECTIONS, { version: "2026-11-12.en" });
    const all = filled.sections.flatMap((s) => [s.title, ...s.paragraphs, ...(s.list ?? [])]);
    expect(all.filter((t) => /\{[a-zA-Z]+\}/.test(t))).toEqual([]);
    // The missing D-T2 values and open points render as markers (and are blockers already).
    expect(filled.missing).toEqual(
      expect.arrayContaining(["registeredAddress", "kvkNumber", "processors"]),
    );
    expect(policyMissingValues(PRIVACY_POLICY_SECTIONS)).toEqual([]);
  });

  it("fills {policyVersion} with the version shown, a draft marker while a draft", () => {
    expect(fillLegalText("Version {policyVersion}", { version: "2026-11-27.en" }).text).toBe(
      "Version 2026-11-27.en",
    );
    expect(fillLegalText("Version {policyVersion}").text).toBe(
      "Version [version assigned on publication]",
    );
    expect(fillLegalText("Version {policyVersion}").missing).toEqual([]);
    expect(fillPrivacyText("{policyVersion}", undefined, undefined, undefined, "v1")).toBe("v1");
  });

  it("freezes a notice's values on publication and refuses a missing one", () => {
    expect(publicationText("CONTACT_NOTICE", "Write to {privacyEmail}.")).toEqual({
      ok: false,
      rule: "missing_value:privacyEmail",
    });
    expect(
      publicationText("CONTACT_NOTICE", "Write to {privacyEmail}.", {
        controller: COMPLETE_CONTROLLER,
      }),
    ).toEqual({ ok: true, text: "Write to privacy@dreampetroleum.example." });
    expect(publicationText("AI_PROCESSING_NOTICE", "Providers: {aiProviders}.")).toEqual({
      ok: false,
      rule: "missing_value:aiProviders",
    });
    expect(publicationText("CONTACT_NOTICE", "{aiProviders}")).toEqual({
      ok: false,
      rule: "unknown_placeholder:aiProviders",
    });
    // The policy keeps its placeholders (filled when shown).
    expect(publicationText("PRIVACY_POLICY", "## A\n\n{kvkNumber}")).toEqual({
      ok: true,
      text: "## A\n\n{kvkNumber}",
    });
  });

  it("keeps production closed while a used value is missing, whatever else is complete", () => {
    const sections = [{ id: "kvkk", title: "KVKK", paragraphs: ["Contact: {kvkkContact}"] }];
    const missing = policyMissingValues(sections, {
      controller: COMPLETE_CONTROLLER,
      values: ALL_VALUES,
    });
    expect(missing).toEqual(["kvkkContact"]);
    const blockers = privacyBlockersFor(
      [],
      COMPLETE_CONTROLLER,
      ALL_VALUES,
      missing.map((placeholder) => ({ locale: "en", placeholder })),
    );
    expect(blockers).toEqual(["DP-306: missing value {kvkkContact} in PRIVACY_POLICY en"]);
    expect(privacyPublication("production", blockers).publish).toBe(false);
    expect(
      privacyPublication("production", privacyBlockersFor([], COMPLETE_CONTROLLER, ALL_VALUES))
        .publish,
    ).toBe(true);
    const done = { ...COMPLETE_CONTROLLER, kvkkContact: "kvkk@dreampetroleum.example" };
    expect(policyMissingValues(sections, { controller: done, values: ALL_VALUES })).toEqual([]);
  });
});
