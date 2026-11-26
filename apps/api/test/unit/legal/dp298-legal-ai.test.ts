/**
 * DP-298 (ADR-031) without a database: the published-text snapshot, version names, the stored form
 * of a text, the AI task data policies and the personal-data gate.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  policyEvidenceText,
  policyToMarkup,
} from "@dream/contracts";
import { publishedTextsFrom, type PublishedRow } from "../../../src/legal/published-texts.js";
import { evidenceOf, versionName } from "../../../src/legal/legal-texts.service.js";
import { AI_TASKS, assertTaskRegistry } from "../../../src/ai/tasks/registry.js";
import {
  dataPolicyProblem,
  minimisedInput,
  personalDataRefusal,
  type AiTaskDataPolicy,
} from "../../../src/ai/engine/personal-data-gate.js";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
let n = 0;
function row(
  p: Partial<PublishedRow> & Pick<PublishedRow, "key" | "locale" | "version">,
): PublishedRow {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    legalReview: "REQUIRED",
    text: `text ${n}`,
    sections: null,
    translatesId: null,
    publishedAt: new Date(`2026-11-${String(10 + n).padStart(2, "0")}T00:00:00Z`),
    ...p,
  };
}
function englishSet(): PublishedRow[] {
  return [
    row({
      key: "PRIVACY_POLICY",
      locale: "en",
      version: "2026-11-12.en",
      sections: PRIVACY_POLICY_SECTIONS,
      text: policyToMarkup(PRIVACY_POLICY_SECTIONS),
    }),
    row({
      key: "DOCUMENT_REQUEST_NOTICE",
      locale: "en",
      version: "2026-11-12.en",
      text: LEAD_PRIVACY_NOTICE.text,
    }),
    row({
      key: "CONTACT_NOTICE",
      locale: "en",
      version: "2026-11-13.en",
      text: LEAD_CONTACT_NOTICE.text,
    }),
    row({
      key: "MARKETING_CONSENT",
      locale: "en",
      version: "2026-11-12.en",
      text: LEAD_MARKETING_CONSENT.text,
      legalReview: "APPROVED",
    }),
  ];
}

describe("DP-298 published texts", () => {
  it("offers a language only with all four texts; the newest version is current", () => {
    const rows = englishSet();
    const older = row({
      key: "DOCUMENT_REQUEST_NOTICE",
      locale: "en",
      version: "2026-11-01",
      text: "old",
    });
    older.publishedAt = new Date("2026-11-01T00:00:00Z");
    const nlOnly = row({ key: "CONTACT_NOTICE", locale: "nl", version: "2026-11-23.nl" });
    const t = publishedTextsFrom([...rows, older, nlOnly]);
    expect(t.sets.map((s) => s.locale)).toEqual(["en"]);
    expect(t.sets[0]?.privacyNotice).toEqual({
      version: "2026-11-12.en",
      text: LEAD_PRIVACY_NOTICE.text,
    });
    expect(t.registry["en"]?.review).toBe("source");
    expect(t.registry["nl"]).toBeUndefined();
    expect(t.pendingReview.map((p) => p.key).sort()).toEqual([
      "CONTACT_NOTICE",
      "DOCUMENT_REQUEST_NOTICE",
      "PRIVACY_POLICY",
    ]);
    expect(t.blockers.filter((b) => b.startsWith("DP-298: legal review"))).toHaveLength(3);
  });

  it("fails closed on a broken policy and on no rows at all", () => {
    const rows = englishSet();
    rows[0] = { ...(rows[0] as PublishedRow), sections: [{ id: 1 }] };
    expect(publishedTextsFrom(rows).sets).toEqual([]);
    expect(publishedTextsFrom([]).registry).toEqual({});
  });

  it("names versions per UTC day and stores the evidence text and hash", () => {
    expect(versionName("2026-11-27", "en", 0)).toBe("2026-11-27.en");
    expect(versionName("2026-11-27", "en", 1)).toBe("2026-11-27.2.en");
    expect(evidenceOf("CONTACT_NOTICE", "  Hello.\r\n")).toEqual({
      text: "Hello.",
      sections: null,
      sha256: sha("Hello."),
    });
    const p = evidenceOf("PRIVACY_POLICY", policyToMarkup(PRIVACY_POLICY_SECTIONS));
    expect(p.sha256).toBe(sha(policyEvidenceText(PRIVACY_POLICY_SECTIONS)));
    expect(() => evidenceOf("MARKETING_CONSENT", "x".repeat(1001))).toThrow();
    expect(() => evidenceOf("PRIVACY_POLICY", "no heading")).toThrow();
  });
});

describe("DP-298 AI task data policies and the personal-data gate", () => {
  const crm: AiTaskDataPolicy = {
    kind: "personal_data",
    purposes: ["crm_record"],
    fields: { company: "company", enquiry: "enquiry" },
    permission: "lead:read",
    maxFieldChars: 500,
  };

  it("keeps every AI-1 task free of personal data (behaviour unchanged)", () => {
    for (const def of Object.values(AI_TASKS)) expect(def.dataPolicy).toEqual({ kind: "none" });
    expect(() => assertTaskRegistry(AI_TASKS)).not.toThrow();
  });

  it("refuses incoherent declarations (minimisation, AI-allowed purposes)", () => {
    expect(dataPolicyProblem(crm)).toBeNull();
    expect(dataPolicyProblem({ ...crm, purposes: [] })).toBe("no_purpose");
    expect(dataPolicyProblem({ ...crm, fields: {} })).toBe("no_fields");
    expect(dataPolicyProblem({ ...crm, purposes: ["analytics"] })).toMatch(
      /^purpose_not_ai_allowed/,
    );
    expect(
      dataPolicyProblem({ ...crm, purposes: ["sales_management"], fields: { email: "contact" } }),
    ).toMatch(/^category_outside_purpose/);
    expect(() =>
      assertTaskRegistry({
        X: { ...(AI_TASKS.DIAGNOSTIC_PING as object), dataPolicy: { ...crm, fields: {} } } as never,
      }),
    ).toThrow(/invalid data policy/);
  });

  it("sends only the declared fields", () => {
    if (crm.kind !== "personal_data") throw new Error("type");
    expect(minimisedInput(crm, '{"company":"Acme","email":"a@b.example"}')).toEqual({
      ok: false,
      code: "field_not_allowed",
    });
    expect(minimisedInput(crm, "free text")).toEqual({ ok: false, code: "input_invalid" });
    expect(minimisedInput(crm, '{"enquiry":" Base oil ","company":"Acme"}')).toEqual({
      ok: true,
      fields: { enquiry: "Base oil", company: "Acme" },
      text: "company: Acme\nenquiry: Base oil",
    });
  });

  it("never allows a live call with personal data before purpose approval and provider terms", () => {
    const ok = { transport: "live" as const, hasPermission: true, providerTermsRecorded: true };
    // Today no purpose is approved for AI: refused whatever else holds.
    expect(personalDataRefusal(crm, ok)).toBe("purpose_not_approved");
    expect(
      personalDataRefusal({ kind: "none" }, { ...ok, providerTermsRecorded: false }),
    ).toBeNull();
  });
});
