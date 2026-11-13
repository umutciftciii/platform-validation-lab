import { describe, expect, it } from "vitest";
import {
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEAD_TEXT_ARCHIVE,
  LeadFormTextsSchema,
  PRIVACY_CONTROLLER,
  PRIVACY_POLICY_OPEN_POINTS,
  PRIVACY_POLICY_SECTIONS,
  currentLeadFormTexts,
  fillPrivacyText,
  privacyBlockers,
  privacyDeployEnv,
  privacyPublication,
} from "../src/index.js";

const ALL_VALUES = Object.fromEntries(
  Object.keys(PRIVACY_POLICY_OPEN_POINTS).map((k) => [k, `value of ${k}`]),
) as Record<keyof typeof PRIVACY_POLICY_OPEN_POINTS, string>;

const COMPLETE = {
  ...PRIVACY_CONTROLLER,
  registeredAddress: "Street 1, City",
  kvkNumber: "12345678",
  privacyEmail: "privacy@example.test",
  dpo: { required: false as const },
};

describe("DP-095 lead form texts", () => {
  it("are versioned per language and differ from every archived version", () => {
    expect(LEAD_PRIVACY_NOTICE.version).toMatch(/^\d{4}-\d{2}-\d{2}\.en$/);
    expect(LEAD_MARKETING_CONSENT.version).toMatch(/^\d{4}-\d{2}-\d{2}\.en$/);
    expect(LEAD_PRIVACY_NOTICE.version.length).toBeLessThanOrEqual(20);
    for (const old of LEAD_TEXT_ARCHIVE.privacyNotice) {
      expect(old.version).not.toBe(LEAD_PRIVACY_NOTICE.version);
      expect(old.text).not.toBe(LEAD_PRIVACY_NOTICE.text);
    }
    for (const old of LEAD_TEXT_ARCHIVE.marketingConsent) {
      expect(old.version).not.toBe(LEAD_MARKETING_CONSENT.version);
    }
  });

  it("the notice states purposes, legal basis, watermark, retention, rights and the policy (D-T3)", () => {
    const t = LEAD_PRIVACY_NOTICE.text;
    expect(t).toMatch(/send you this document/);
    expect(t).toMatch(/legitimate interest/);
    expect(t).toMatch(/marked with your name, your company and a request reference/);
    expect(t).toMatch(/24 months after your last request/);
    expect(t).toMatch(/see, correct or delete them, or object/);
    expect(t).toMatch(/Privacy Policy/);
  });

  it("the marketing text is about e-mail and says how to withdraw (D-T4)", () => {
    expect(LEAD_MARKETING_CONSENT.text).toMatch(/^Yes, /);
    expect(LEAD_MARKETING_CONSENT.text).toMatch(/withdraw this at any time/);
  });

  it("current texts match the schema the site serves", () => {
    const texts = LeadFormTextsSchema.parse(currentLeadFormTexts());
    expect(texts.privacyNotice.version).toBe(LEAD_PRIVACY_NOTICE.version);
    expect(texts.marketingConsent.text).toBe(LEAD_MARKETING_CONSENT.text);
  });
});

describe("DP-095 publication gate (D-T2, D-T5)", () => {
  it("lists every missing controller detail; nothing is guessed", () => {
    expect(PRIVACY_CONTROLLER.registeredAddress).toBeNull();
    expect(PRIVACY_CONTROLLER.kvkNumber).toBeNull();
    expect(PRIVACY_CONTROLLER.privacyEmail).toBeNull();
    expect(PRIVACY_CONTROLLER.dpo).toBeNull();
    const blockers = privacyBlockers();
    expect(blockers).toEqual(
      expect.arrayContaining([
        "D-T2: registered address",
        "D-T2: Chamber of Commerce (KvK) number",
        "D-T2: privacy contact e-mail",
        "D-T2: whether a DPO is required, and the contact if so",
        "D-T3: lead privacy notice not marked final",
        "DP-151: contact form privacy notice not marked final",
      ]),
    );
  });

  it("drafts show locally and on staging, never in production", () => {
    expect(privacyPublication("local")).toMatchObject({ publish: true, draft: true });
    expect(privacyPublication("staging")).toMatchObject({ publish: true, draft: true });
    expect(privacyPublication("production")).toMatchObject({ publish: false, draft: true });
  });

  it("publishes in production only when nothing is missing", () => {
    expect(privacyBlockers(COMPLETE, ALL_VALUES, true, true)).toEqual([]);
    expect(privacyPublication("production", [])).toEqual({
      publish: true,
      draft: false,
      blockers: [],
    });
    expect(privacyBlockers(COMPLETE, ALL_VALUES, false, true)).toEqual([
      "D-T3: lead privacy notice not marked final",
    ]);
    // DP-151: the contact form's notice is a draft until it is approved.
    expect(privacyBlockers(COMPLETE, ALL_VALUES, true, false)).toEqual([
      "DP-151: contact form privacy notice not marked final",
    ]);
    expect(privacyBlockers({ ...COMPLETE, kvkNumber: null }, ALL_VALUES, true, true)).toEqual([
      "D-T2: Chamber of Commerce (KvK) number",
    ]);
  });

  it("an unknown deploy environment counts as production (fail closed)", () => {
    expect(privacyDeployEnv(undefined)).toBe("local");
    expect(privacyDeployEnv("")).toBe("local");
    expect(privacyDeployEnv("staging")).toBe("staging");
    expect(privacyDeployEnv("production")).toBe("production");
    expect(privacyDeployEnv("prod")).toBe("production");
  });
});

describe("DP-095 privacy policy text", () => {
  it("marks missing values visibly instead of inventing them", () => {
    const filled = PRIVACY_POLICY_SECTIONS.flatMap((s) => [...s.paragraphs, ...(s.list ?? [])])
      .map((p) => fillPrivacyText(p))
      .join("\n");
    expect(filled).toContain("[pending: registered address]");
    expect(filled).toContain("[pending: KvK number]");
    expect(filled).toContain("[pending: privacy contact e-mail]");
    expect(filled).toContain("[pending: DPO decision]");
    expect(filled).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it("uses the supplied values once they exist", () => {
    const text = fillPrivacyText(
      "{kvkNumber} / {privacyEmail} / {dpo} / {backups}",
      COMPLETE,
      ALL_VALUES,
    );
    expect(text).toBe(
      "12345678 / privacy@example.test / not required for our organisation / value of backups",
    );
  });

  it("states the retention rules of DP-096 (D-R1, D-R2)", () => {
    const retention = PRIVACY_POLICY_SECTIONS.find((s) => s.id === "retention");
    const text = retention?.paragraphs.join(" ") ?? "";
    expect(text).toMatch(/24 months/);
    expect(text).toMatch(/does not keep your details indefinitely/);
    expect(text).toMatch(/90 days/);
  });
});
