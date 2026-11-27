/**
 * DP-306 (ADR-031 D1): the placeholders of the legal texts — which exist, which document type may
 * use which, and how a text is checked and filled. One module, used by the API (save, publish,
 * preview, production gate), the sites (rendering) and the admin (preview), so all three resolve
 * a text the same way.
 *
 * Sources of a value:
 *  - `controller`: the owner's controller details (`PRIVACY_CONTROLLER`, D-T2; never guessed).
 *  - `open_point`: a policy point other backlog items settle (`PRIVACY_POLICY_VALUES`).
 *  - `auto`: `{policyVersion}`, the version being shown (named on publication).
 *  - `future`: values of processing that does not happen yet (AI-assisted processing,
 *    international transfers). They have no value in code, so a text using them can be saved as a
 *    draft of its own document but can never be published, and the active texts (policy, form
 *    notices, marketing consent) refuse them outright.
 *
 * Rules (`placeholderProblem`, on every draft save and on publication):
 *  - a placeholder that does not exist, or that the document type may not use, is refused as
 *    `unknown_placeholder:<name>`;
 * On publication (`publicationProblem`):
 *  - the privacy policy keeps its placeholders (it is filled when rendered); a missing controller
 *    or open-point value renders as "[pending: …]" and keeps the production gate closed
 *    (`policyMissingValues` → `privacyBlockersFor`);
 *  - a notice or consent text is consent EVIDENCE: the exact words the visitor sees are hashed.
 *    Its placeholders are therefore filled into the text when it is published; a value that is
 *    missing refuses the publication as `missing_value:<name>`. A published notice never holds a
 *    `{…}` placeholder.
 */
import type { LegalDocumentKey } from "./admin/legal-texts.js";
import {
  PRIVACY_CONTROLLER,
  PRIVACY_FILL_LABELS_EN,
  PRIVACY_POLICY_VALUES,
  resolvePlaceholders,
  type PlaceholderFill,
  type PrivacyFillLabels,
  type PrivacyOpenPoint,
  type PrivacySection,
} from "./privacy.js";

export type PlaceholderSource = "controller" | "open_point" | "auto" | "future";

export interface PlaceholderDef {
  source: PlaceholderSource;
  /** For `future`: the processing it belongs to. */
  process?: "ai" | "transfer";
  /** Whether a missing value is already a production blocker of its own (D-T2, open points). */
  coveredByBlockers: boolean;
}

const controller = (coveredByBlockers: boolean): PlaceholderDef => ({
  source: "controller",
  coveredByBlockers,
});
const openPoint: PlaceholderDef = { source: "open_point", coveredByBlockers: true };
const future = (process: "ai" | "transfer"): PlaceholderDef => ({
  source: "future",
  process,
  coveredByBlockers: false,
});

/** Every placeholder (20). `{braces}` in the draft header is prose, not a placeholder. */
export const LEGAL_PLACEHOLDERS = {
  legalName: controller(false),
  registeredAddress: controller(true),
  kvkNumber: controller(true),
  privacyEmail: controller(true),
  dpo: controller(true),
  supervisoryAuthority: controller(false),
  kvkkContact: controller(false),
  processors: openPoint,
  transfers: openPoint,
  cookies: openPoint,
  customerRecords: openPoint,
  evidenceRetention: openPoint,
  backups: openPoint,
  policyVersion: { source: "auto", coveredByBlockers: false },
  aiProviders: future("ai"),
  transferRecipients: future("transfer"),
  transferCountries: future("transfer"),
  transferPurpose: future("transfer"),
  gdprTransferMechanism: future("transfer"),
  kvkkTransferMechanism: future("transfer"),
} as const satisfies Record<string, PlaceholderDef>;
export type LegalPlaceholder = keyof typeof LEGAL_PLACEHOLDERS;

const names = (filter: (d: PlaceholderDef) => boolean): LegalPlaceholder[] =>
  (Object.keys(LEGAL_PLACEHOLDERS) as LegalPlaceholder[]).filter((n) =>
    filter(LEGAL_PLACEHOLDERS[n]),
  );
const CONTROLLER = names((d) => d.source === "controller");
const OPEN_POINTS = names((d) => d.source === "open_point");
const AI = names((d) => d.process === "ai");
const TRANSFER = names((d) => d.process === "transfer");

/** The placeholders each document type may use (anything else: `unknown_placeholder`). */
export const ALLOWED_PLACEHOLDERS: Readonly<Record<LegalDocumentKey, readonly LegalPlaceholder[]>> =
  {
    PRIVACY_POLICY: [...CONTROLLER, ...OPEN_POINTS, "policyVersion"],
    DOCUMENT_REQUEST_NOTICE: CONTROLLER,
    CONTACT_NOTICE: CONTROLLER,
    MARKETING_CONSENT: CONTROLLER,
    AI_PROCESSING_NOTICE: [...CONTROLLER, ...AI],
    AI_PROCESSING_CONSENT: [...CONTROLLER, ...AI],
    INTERNATIONAL_TRANSFER_NOTICE: [...CONTROLLER, "processors", "transfers", ...TRANSFER],
    INTERNATIONAL_TRANSFER_CONSENT: [...CONTROLLER, ...TRANSFER],
  };

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** The placeholder names a text uses, in order of first use, each once. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))];
}

function sectionsText(sections: readonly PrivacySection[]): string {
  return sections.flatMap((s) => [s.title, ...s.paragraphs, ...(s.list ?? [])]).join("\n");
}

/** `unknown_placeholder:<name>` for the first placeholder the document may not use, else null. */
export function placeholderProblem(key: LegalDocumentKey, text: string): string | null {
  const allowed: readonly string[] = ALLOWED_PLACEHOLDERS[key];
  for (const name of placeholdersIn(text)) {
    if (!allowed.includes(name)) return `unknown_placeholder:${name}`;
  }
  return null;
}

export interface FillContext {
  controller?: typeof PRIVACY_CONTROLLER;
  values?: Readonly<Record<PrivacyOpenPoint, string | null>>;
  labels?: PrivacyFillLabels;
  /** The version being shown (null: a draft). */
  version?: string | null;
}

/** Fills a text the way it is shown (API preview, admin preview, site rendering). */
export function fillLegalText(text: string, ctx: FillContext = {}): PlaceholderFill {
  return resolvePlaceholders(
    text,
    ctx.controller ?? PRIVACY_CONTROLLER,
    ctx.values ?? PRIVACY_POLICY_VALUES,
    ctx.labels ?? PRIVACY_FILL_LABELS_EN,
    ctx.version ?? null,
  );
}

/** The policy sections filled, and the placeholders whose value is missing (deduplicated). */
export function fillPolicySections(
  sections: readonly PrivacySection[],
  ctx: FillContext = {},
): { sections: PrivacySection[]; missing: string[] } {
  const missing = new Set<string>();
  const fill = (t: string) => {
    const r = fillLegalText(t, ctx);
    for (const m of r.missing) missing.add(m);
    return r.text;
  };
  const out = sections.map((s) => ({
    id: s.id,
    title: fill(s.title),
    paragraphs: s.paragraphs.map(fill),
    ...(s.list ? { list: s.list.map(fill) } : {}),
  }));
  return { sections: out, missing: [...missing] };
}

/**
 * The missing values of a policy that are NOT already production blockers of their own (D-T2 and
 * open points are): today `{kvkkContact}`. The production gate adds these (`privacyBlockersFor`).
 */
export function policyMissingValues(
  sections: readonly PrivacySection[],
  ctx: FillContext = {},
): LegalPlaceholder[] {
  return fillPolicySections(sections, ctx).missing.filter(
    (n): n is LegalPlaceholder =>
      Object.hasOwn(LEGAL_PLACEHOLDERS, n) &&
      !LEGAL_PLACEHOLDERS[n as LegalPlaceholder].coveredByBlockers,
  );
}

/** Whether every placeholder of the policy is one it may use (for the sections form). */
export function policyPlaceholderProblem(sections: readonly PrivacySection[]): string | null {
  return placeholderProblem("PRIVACY_POLICY", sectionsText(sections));
}

export type PublicationResult = { ok: true; text: string } | { ok: false; rule: string };

/**
 * The text as it is frozen on publication. The policy keeps its placeholders (filled when shown);
 * a notice or consent text gets its values filled in, and a missing value refuses it.
 */
export function publicationText(
  key: LegalDocumentKey,
  text: string,
  ctx: FillContext = {},
): PublicationResult {
  const problem = placeholderProblem(key, text);
  if (problem) return { ok: false, rule: problem };
  if (key === "PRIVACY_POLICY") return { ok: true, text };
  const filled = fillLegalText(text, { ...ctx, version: null });
  const missing = filled.missing[0];
  if (missing) return { ok: false, rule: `missing_value:${missing}` };
  // A future placeholder has no value source: never filled, never published.
  const left = placeholdersIn(filled.text)[0];
  if (left) return { ok: false, rule: `missing_value:${left}` };
  return { ok: true, text: filled.text };
}
