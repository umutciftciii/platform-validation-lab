// ML-12a (DP-243): catalogue errors and issues in the console's language, translated by code — the
// API contract and its English messages do not change (ADR-028 D15).
//   - Validation and publication-readiness issues (lib/catalog-issues.ts): every message the shared
//     engine can produce comes back unchanged in English and fully Turkish in Turkish, with the
//     values (names, units, limits, test methods) untouched; unknown codes keep the API's message.
//   - API errors of the catalogue client (lib/catalog-client.ts messageForIssues): field issues,
//     error codes, per-language rules and the generic fallback, in both languages.
import {
  checkPublication,
  checkSpecValue,
  DEFAULT_ERROR_MESSAGES,
  ISSUE_CODES,
  PUBLICATION_ISSUE_CODES,
  SENSITIVE_CLAIMS,
  validateProductData,
  type DefinitionRule,
  type PublicationIssue,
  type SpecDefinition,
  type ValidationIssue,
} from "@dream/contracts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { messageForIssues } from "../lib/catalog-client";
import { issueText } from "../lib/catalog-issues";
import { browserAdminLocale } from "../lib/i18n/config";
import { en } from "../lib/i18n/messages/en";
import { tr } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";
import { liveValidation, slotKey, type Draft } from "../lib/spec-validation";

const EN = createTranslator("en");
const TR = createTranslator("tr");

const def = (over: Partial<DefinitionRule> = {}): DefinitionRule => ({
  id: "d1",
  key: "kv100",
  name: "Kinematic viscosity at 100 °C",
  dataType: "NUMBER",
  units: ["mm²/s"],
  testMethods: ["ASTM D445", "ISO 3104"],
  required: true,
  minValue: 0,
  maxValue: 1000,
  decimals: 2,
  maxLength: null,
  archived: false,
  ...over,
});

const num = (
  n: number,
  unit: string | null = "mm²/s",
  testMethod: string | null = "ASTM D445",
) => ({
  definitionId: "d1",
  value: { type: "NUMBER" as const, number: n },
  unit,
  testMethod,
});
const range = (
  min: number | null,
  max: number | null,
  minExclusive = false,
  maxExclusive = false,
) => ({
  definitionId: "d1",
  value: { type: "RANGE" as const, min, max, minExclusive, maxExclusive },
  unit: "mm²/s",
  testMethod: "ASTM D445",
});

/** Every wording of every engine code (contracts checkSpecValue / validateProductData). */
function allSpecIssues(): ValidationIssue[] {
  const d = def();
  const r = def({ dataType: "RANGE" });
  const text = def({
    dataType: "TEXT",
    units: [],
    testMethods: [],
    maxLength: 5,
    minValue: null,
    maxValue: null,
    decimals: null,
  });
  return [
    ...checkSpecValue(d, { ...num(1), value: { type: "TEXT", text: "x" } }), // invalid_type
    ...checkSpecValue(d, num(1, "cSt")), // invalid_unit (one of)
    ...checkSpecValue(text, { ...num(1, "cSt", null), value: { type: "TEXT", text: "ok" } }), // no unit
    ...checkSpecValue(r, range(null, null)),
    ...checkSpecValue(r, range(null, 5, true)),
    ...checkSpecValue(r, range(1, null, false, true)),
    ...checkSpecValue(r, range(9, 3)),
    ...checkSpecValue(r, range(3, 3, true)),
    ...checkSpecValue(d, num(5000)), // out_of_bounds
    ...checkSpecValue(def({ minValue: null, maxValue: null }), num(-1)),
    ...checkSpecValue(def({ minValue: null }), num(5000)), // "−∞"
    ...checkSpecValue(d, num(1.234)), // too_precise
    ...checkSpecValue(text, { ...num(1, null, null), value: { type: "TEXT", text: "too long" } }),
    ...checkSpecValue(d, num(1, "mm²/s", null)), // test_method_missing
    ...[
      validateProductData({
        definitions: [d],
        values: [],
        images: [{ id: "img1", altText: null }],
      }),
      validateProductData({ definitions: [], values: [num(1)], images: [] }),
    ].flatMap((v) => [...v.blocking, ...v.warnings]),
  ];
}

/** Every wording of every publication-readiness code (contracts checkPublication). */
function allPublicationIssues(): PublicationIssue[] {
  const validation = { ok: true, blocking: [], warnings: [] };
  const base = {
    product: { status: "DRAFT" as const, summary: null, description: null },
    listing: null,
    validation,
    images: [],
  };
  const texts =
    "SAF jet fuel, pharmaceutical, cosmetic, food grade, medical, GTL, certified, biodegradable";
  return [
    checkPublication(base),
    checkPublication({ ...base, mode: "DIRECT" }),
    checkPublication({
      ...base,
      product: { status: "ARCHIVED", summary: "s", description: "d" },
    }),
    checkPublication({
      ...base,
      listing: { visibility: "HIDDEN", text: { title: texts, summary: null, description: null } },
      canShowListing: true,
      proposal: { status: "REVIEW_PENDING" },
    }),
    checkPublication({ ...base, listing: { visibility: "HIDDEN", text: null } }),
  ].flatMap((r) => [...r.blocking, ...r.warnings]);
}

describe("validation and publication issues in the console's language", () => {
  const spec = allSpecIssues();
  const publication = allPublicationIssues();

  it("the fixtures reach every engine and publication code", () => {
    const codes = new Set([...spec, ...publication].map((i) => i.code));
    for (const code of ISSUE_CODES.filter((c) => c !== "optional_missing"))
      expect(codes, code).toContain(code);
    for (const code of PUBLICATION_ISSUE_CODES) expect(codes, code).toContain(code);
    expect(publication.filter((i) => i.code === "sensitive_claim")).toHaveLength(
      SENSITIVE_CLAIMS.length,
    );
  });

  it("English is the API's message, character for character", () => {
    for (const i of [...spec, ...publication]) expect(issueText(i, EN), i.code).toBe(i.message);
  });

  it("Turkish translates every message and keeps names, units, limits and methods", () => {
    for (const i of [...spec, ...publication]) {
      const text = issueText(i, TR);
      expect(text, i.message).not.toBe(i.message);
      expect(text, i.message).not.toMatch(
        /\b(?:is required|expected a|must be one of|allowed range|at most|no test method|cannot|the product|publish it)\b/i,
      );
    }
    const byCode = (code: string) => spec.find((i) => i.code === code)!;
    expect(issueText(byCode("invalid_unit"), TR)).toBe(
      "Kinematic viscosity at 100 °C: birim şunlardan biri olmalıdır: mm²/s.",
    );
    expect(issueText(byCode("test_method_missing"), TR)).toBe(
      "Kinematic viscosity at 100 °C: test yöntemi yok (önerilen: ASTM D445, ISO 3104).",
    );
    expect(issueText(byCode("invalid_type"), TR)).toBe(
      "Kinematic viscosity at 100 °C: sayı türünde bir değer bekleniyor.",
    );
    expect(spec.filter((i) => i.code === "out_of_bounds").map((i) => issueText(i, TR))).toContain(
      "Kinematic viscosity at 100 °C: izin verilen aralık −∞ ile 1000 arasıdır.",
    );
    const food = publication.find((i) => i.target === "text:food")!;
    expect(issueText(food, TR)).toBe(
      "Herkese açık metin gıda kalitesi veya gıdayla temas ifadesi içeriyor: yalnızca bir sertifika veya kaynak belgeyle yayınlayın.",
    );
  });

  it("the console's own checks (lib/spec-validation) and the plain listing wording", () => {
    const d = def() as unknown as SpecDefinition;
    const draft = (basis: Draft["basis"], number: string): Draft => ({
      on: true,
      basis,
      number,
      min: "",
      max: "",
      minExclusive: false,
      maxExclusive: false,
      text: "",
      bool: "",
      unit: "mm²/s",
      testMethod: "ASTM D445",
    });
    const drafts: Record<string, Draft> = {
      [slotKey("d1", "SPECIFICATION")]: draft("SPECIFICATION", ""),
      [slotKey("d1", "TYPICAL")]: draft("TYPICAL", "abc"),
    };
    const live = liveValidation([d], drafts, { ok: true, blocking: [], warnings: [] });
    const messages = live.blocking.map((i) => i.message);
    expect(messages).toEqual([
      "Kinematic viscosity at 100 °C: enter a value or remove it.",
      "Kinematic viscosity at 100 °C (typical): enter a number.",
    ]);
    expect(live.blocking.map((i) => issueText(i, EN))).toEqual(messages);
    expect(live.blocking.map((i) => issueText(i, TR))).toEqual([
      "Kinematic viscosity at 100 °C: bir değer girin veya kaldırın.",
      "Kinematic viscosity at 100 °C (tipik): bir sayı girin.",
    ]);
    const plain = {
      code: "listing_hidden",
      target: "listing",
      message: en.catalog.issues.plain.listing_hidden,
    };
    expect(issueText(plain, EN)).toBe(plain.message);
    expect(issueText(plain, TR)).toBe(tr.catalog.issues.plain.listing_hidden);
  });

  it("an unknown code or wording keeps the API's message (never empty, never a raw key)", () => {
    const unknown = { code: "brand_new_rule", target: "x", message: "Something new happened." };
    expect(issueText(unknown, TR)).toBe("Something new happened.");
    const changed = { code: "cover_missing", target: "images", message: "A cover is needed now." };
    expect(issueText(changed, TR)).toBe("A cover is needed now.");
    const odd = { code: "invalid_type", target: "spec:x", message: "X: expected a colour value." };
    expect(issueText(odd, TR)).toBe(odd.message);
  });
});

describe("catalogue API errors (messageForIssues)", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("English: the field rules, codes and fallbacks of before ML-12a", () => {
    expect(messageForIssues("CONFLICT_VERSION", [{ path: "version", rule: "stale" }], EN)).toBe(
      "Someone else changed this record. Reload the page to see their version.",
    );
    expect(messageForIssues("FORBIDDEN", [], EN)).toBe(DEFAULT_ERROR_MESSAGES.FORBIDDEN);
    expect(messageForIssues(null, [], EN)).toBe(
      "The change could not be saved. Try again in a moment.",
    );
    expect(
      messageForIssues(
        "VALIDATION_FAILED",
        [{ path: "nl:category", rule: "translation_missing" }],
        EN,
      ),
    ).toBe("Some texts are not translated yet (NL): see what is needed under Languages.");
    expect(
      messageForIssues("VALIDATION_FAILED", [{ path: "nl", rule: "manual_review_required" }], EN),
    ).toBe("Confirm that you checked the NL text by hand before publishing it.");
    expect(messageForIssues("VALIDATION_FAILED", [{ path: "spec:kv100", rule: "x" }], EN)).toBe(
      "Fix the blocking specification issues first (see the validation report).",
    );
    expect(
      messageForIssues(
        "VALIDATION_FAILED",
        [
          { path: "name", rule: "too_long" },
          { path: "code", rule: "x" },
        ],
        EN,
      ),
    ).toBe("Check these fields: name, code.");
  });

  it("Turkish: the same decisions, Turkish text, codes and field paths unchanged", () => {
    expect(messageForIssues("CONFLICT_VERSION", [{ path: "version", rule: "stale" }], TR)).toBe(
      tr.catalog.rules["version:stale"],
    );
    expect(messageForIssues("FORBIDDEN", [], TR)).toBe(tr.errors.FORBIDDEN);
    expect(messageForIssues("SOMETHING_NEW", [], TR)).toBe(tr.catalog.api.notSaved);
    expect(messageForIssues("VALIDATION_FAILED", [{ path: "name", rule: "too_long" }], TR)).toBe(
      "Şu alanları kontrol edin: name.",
    );
    for (const key of Object.keys(en.catalog.rules) as (keyof typeof en.catalog.rules)[]) {
      const [path, rule] = [
        key.slice(0, key.lastIndexOf(":")),
        key.slice(key.lastIndexOf(":") + 1),
      ];
      expect(messageForIssues("VALIDATION_FAILED", [{ path, rule }], TR), key).toBe(
        tr.catalog.rules[key],
      );
      expect(messageForIssues("VALIDATION_FAILED", [{ path, rule }], EN), key).toBe(
        en.catalog.rules[key],
      );
    }
  });

  it("without `t`, follows the console language cookie in the browser (English on the server)", () => {
    expect(browserAdminLocale()).toBe("en");
    expect(messageForIssues("FORBIDDEN", [])).toBe(DEFAULT_ERROR_MESSAGES.FORBIDDEN);
    (globalThis as { document?: unknown }).document = { cookie: "a=1; dp-admin-locale=tr" };
    expect(browserAdminLocale()).toBe("tr");
    expect(messageForIssues("FORBIDDEN", [])).toBe(tr.errors.FORBIDDEN);
    (globalThis as { document?: unknown }).document = { cookie: "dp-admin-locale=de" };
    expect(browserAdminLocale()).toBe("en");
  });
});

describe("the API's fixed direct-publication history note", () => {
  it("is recognised word for word (apps/api DIRECT_PUBLICATION_NOTE) and translated", () => {
    const api = readFileSync(
      fileURLToPath(new URL("../../api/src/catalog/workflow.service.ts", import.meta.url)),
      "utf8",
    );
    expect(api).toContain(JSON.stringify(en.catalog.workflow.history.directNote));
    expect(tr.catalog.workflow.history.directNote).not.toBe(en.catalog.workflow.history.directNote);
  });
});
