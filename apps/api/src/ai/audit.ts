/**
 * DP-288 (ADR-030 D7; owner decision 11): the AI audit events and what their metadata may hold.
 * Audit events of the AI Center carry ids, codes, counts and amounts only — never an API key, a
 * prompt, a response or any other free text. `aiAuditMetadata` keeps only the allowed keys and
 * scalar values (a nested object or a long string is dropped), before the general masking of
 * iam/audit.ts runs.
 */
export const AI_AUDIT_ACTIONS = [
  "ai.access_denied",
  "ai.settings.update",
  "ai.provider.update",
  "ai.credential.add",
  "ai.credential.test",
  "ai.credential.activate",
  "ai.credential.disable",
  "ai.credential.revoke",
  "ai.credential.reencrypt",
  "ai.model.discover",
  "ai.model.verify",
  "ai.model.enable",
  "ai.model.disable",
  "ai.price.add",
  "ai.task.update",
  "ai.budget.create",
  "ai.budget.update",
  "ai.budget.deactivate",
  "ai.operation.denied",
  "ai.operation.overrun",
  "ai.operation.unknown",
  "ai.operation.discarded",
  "ai.estimate.underrun",
  "ai.reconciliation.record",
] as const;
export type AiAuditAction = (typeof AI_AUDIT_ACTIONS)[number];

/** Metadata keys an AI audit event may carry. */
export const AI_AUDIT_METADATA_KEYS = [
  "permission",
  "provider",
  "credentialId",
  "keyHint",
  "status",
  "previousStatus",
  "modelId",
  "modelKey",
  "priceId",
  "task",
  "budgetId",
  "scope",
  "siteId",
  "period",
  "limitMicros",
  "previousLimitMicros",
  "operationId",
  "reservedMicros",
  "actualMicros",
  "code",
  "version",
  "day",
  "amountMicros",
] as const;

const ALLOWED = new Set<string>(AI_AUDIT_METADATA_KEYS);
const MAX = 120;

export function aiAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value === "bigint") out[key] = value.toString();
    else if (typeof value === "number" || typeof value === "boolean" || value === null)
      out[key] = value;
    else if (typeof value === "string" && value.length <= MAX) out[key] = value;
  }
  return out;
}
