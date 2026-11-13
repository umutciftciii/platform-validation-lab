/**
 * Audit events (F1-001, DP-070): who, when, in which scope, what, and the outcome. The table is
 * append-only (database triggers). Metadata is masked here before it is written: secrets are
 * redacted and e-mail addresses are reduced to their first letter and domain.
 */
import type { ScopeTypeValue } from "./catalog.js";

export type AuditActorTypeValue = "USER" | "SYSTEM" | "BOOTSTRAP";
export type AuditOutcomeValue = "SUCCESS" | "DENIED" | "FAILURE";

export interface AuditEventInput {
  actorType: AuditActorTypeValue;
  actorUserId?: string | null;
  /** `<area>.<verb>`, snake_case, e.g. `role_assignment.grant`. */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  scopeType: ScopeTypeValue;
  siteId?: string | null;
  outcome: AuditOutcomeValue;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export interface AuditEventData {
  actorType: AuditActorTypeValue;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  scopeType: ScopeTypeValue;
  siteId: string | null;
  outcome: AuditOutcomeValue;
  reason: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
}

const SECRET_KEY =
  /pass(word)?|secret|token|otp|totp|mfa_?code|recovery|hash|cookie|session|authorization|api_?key|private_?key|credential/i;
const EMAIL = /^([^\s@])[^\s@]*@([^\s@]+\.[^\s@]+)$/;
const MAX_DEPTH = 5;
const MAX_STRING = 500;

export function maskEmail(value: string): string {
  const m = EMAIL.exec(value.trim());
  return m ? `${m[1]}***@${m[2]}` : value;
}

export function maskValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") {
    const masked = maskEmail(value);
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : maskValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  return value;
}

export function maskMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return maskValue(metadata) as Record<string, unknown>;
}

export class InvalidAuditEventError extends Error {
  override name = "InvalidAuditEventError";
}

const ACTION = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

/** Validates and masks an event; the result is ready for `auditEvent.create({ data })`. */
export function buildAuditEvent(input: AuditEventInput): AuditEventData {
  const invalid = (msg: string): never => {
    throw new InvalidAuditEventError(`audit event: ${msg}`);
  };
  if (!ACTION.test(input.action)) invalid("action must be <area>.<verb> in snake_case");
  if (!input.resourceType) invalid("resourceType is required");
  const actorUserId = input.actorUserId ?? null;
  if ((input.actorType === "USER") !== (actorUserId !== null)) {
    invalid("a USER actor needs actorUserId; SYSTEM and BOOTSTRAP actors have none");
  }
  const siteId = input.siteId ?? null;
  if ((input.scopeType === "SITE") !== (siteId !== null)) {
    invalid("SITE scope needs siteId; PLATFORM scope has none");
  }
  return {
    actorType: input.actorType,
    actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    scopeType: input.scopeType,
    siteId,
    outcome: input.outcome,
    reason: input.reason ?? null,
    metadata: maskMetadata(input.metadata),
    requestId: input.requestId ?? null,
  };
}
