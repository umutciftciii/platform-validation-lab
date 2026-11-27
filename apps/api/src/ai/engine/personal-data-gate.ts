/**
 * DP-298 (ADR-031 D6): when an AI task may handle personal data.
 *
 * The owner decided (2026-11-27) that AI is NOT categorically barred from lead and CRM data: an
 * authorised CRM workflow may use AI. What stays mandatory is data minimisation, role-based
 * access and control over what reaches a provider. A task therefore DECLARES its data policy:
 *
 *  - `none` (every AI-1 task): no personal data. The input is free text checked by the regex
 *    filter (input-policy.ts) — a safety net for pasted text, never proof that no personal data
 *    is sent.
 *  - `personal_data`: the purposes it serves and the exact FIELDS it may send. The input is a JSON
 *    object of those fields only (anything else is refused before any reservation). It runs only
 *    when all of these hold:
 *      1. every purpose is approved for AI (`aiPurposeReady`: active, approved, AI allowed);
 *      2. the caller holds the permission that opens the data (e.g. `lead:read` on the site);
 *      3. the transport is `fake` or `live`, AND the provider's data-processing terms are recorded
 *         by the system owner (DPA, GDPR and KVKK transfer mechanisms, region, retention, no
 *         training). DP-307: the fake transport needs them too (the same path as production), and
 *         the operation stores the exact record (`dataTermsId`): the database checks it at the
 *         reservation (ai_reserve) and again when the request is sent (ai_dispatch); a revoked or
 *         renewed record ends it with `provider_terms_revoked`, no request and cost 0.
 *    The regex filter does not apply (the data is expected); the audit names the purposes and the
 *    field NAMES, never values.
 *
 * Nothing here reads lead data: the CRM workflow that builds the input lives outside src/ai and
 * passes only the declared fields (ESLint keeps src/ai away from the lead modules).
 */
import {
  DATA_CATEGORIES,
  PROCESSING_PURPOSES,
  aiPurposeReady,
  type AiPersonalDataRefusal,
  type DataCategory,
  type ProcessingPurposeId,
} from "@dream/contracts";
import type { AiTransport } from "../config/ai-config.js";

export type AiTaskDataPolicy =
  | { kind: "none" }
  | {
      kind: "personal_data";
      purposes: readonly ProcessingPurposeId[];
      /** Field name → its data category; the only keys the input may have. */
      fields: Readonly<Record<string, DataCategory>>;
      /** The permission the caller must hold on the operation's site. */
      permission: string;
      maxFieldChars: number;
    };

export const NO_PERSONAL_DATA: AiTaskDataPolicy = { kind: "none" };

/** Registry check (module start and tests): a personal-data task must be coherent. */
export function dataPolicyProblem(policy: AiTaskDataPolicy): string | null {
  if (policy.kind === "none") return null;
  if (policy.purposes.length === 0) return "no_purpose";
  const names = Object.keys(policy.fields);
  if (names.length === 0) return "no_fields";
  for (const id of policy.purposes) {
    const p = PROCESSING_PURPOSES[id];
    if (!p) return "unknown_purpose";
    if (!p.aiAllowed) return `purpose_not_ai_allowed:${id}`;
  }
  for (const [name, category] of Object.entries(policy.fields)) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(name)) return `bad_field:${name}`;
    if (!(DATA_CATEGORIES as readonly string[]).includes(category)) return `bad_category:${name}`;
    // Minimisation: every field's category is one that all the task's purposes use.
    if (!policy.purposes.every((id) => PROCESSING_PURPOSES[id].dataCategories.includes(category))) {
      return `category_outside_purpose:${name}`;
    }
  }
  if (!policy.permission) return "no_permission";
  if (policy.maxFieldChars < 1) return "no_field_limit";
  return null;
}

export type FieldsResult =
  | { ok: true; fields: Record<string, string>; text: string }
  | { ok: false; code: AiPersonalDataRefusal | "input_invalid" };

/** The declared fields of a personal-data input (strict: unknown fields are refused). */
export function minimisedInput(
  policy: Extract<AiTaskDataPolicy, { kind: "personal_data" }>,
  input: string,
): FieldsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { ok: false, code: "input_invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, code: "input_invalid" };
  }
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Object.hasOwn(policy.fields, name)) return { ok: false, code: "field_not_allowed" };
    if (typeof value !== "string" || value.length > policy.maxFieldChars) {
      return { ok: false, code: "input_invalid" };
    }
    fields[name] = value.trim();
  }
  if (Object.keys(fields).length === 0) return { ok: false, code: "input_invalid" };
  // Stable order, field names as the provider sees them.
  const text = Object.keys(policy.fields)
    .filter((n) => n in fields)
    .map((n) => `${n}: ${fields[n]}`)
    .join("\n");
  return { ok: true, fields, text };
}

export interface GateFacts {
  transport: AiTransport;
  /** The caller holds `policy.permission` on the operation's site. */
  hasPermission: boolean;
  /** The owner recorded unrevoked data-processing terms for the plan's provider (any transport). */
  providerTermsRecorded: boolean;
}

/** The first reason a personal-data task may not run now (null: it may). */
export function personalDataRefusal(
  policy: AiTaskDataPolicy,
  facts: GateFacts,
): AiPersonalDataRefusal | null {
  if (policy.kind === "none") return null;
  if (!policy.purposes.every((id) => aiPurposeReady(id))) return "purpose_not_approved";
  if (!facts.hasPermission) return "permission_missing";
  if (facts.transport !== "live" && facts.transport !== "fake") return "transport_not_allowed";
  // DP-307: terms are required with every transport, the fake one included.
  if (!facts.providerTermsRecorded) return "provider_terms_missing";
  return null;
}
