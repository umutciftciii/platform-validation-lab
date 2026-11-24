/**
 * Staff and role administration from the browser (DP-076 revision, DP-107; ADR-017 v2), through
 * the admin's same-origin proxy. A call answering AUTH_STEP_UP_REQUIRED (user invitations keep
 * their step-up) returns `stepUp: true` so the form can ask for an authenticator code.
 *
 * ML-12e (DP-243): the messages are in the admin UI language (by the API's code and rule, as
 * lib/cms-client.ts and lib/redirects-client.ts); request paths, bodies and every API code are
 * unchanged. Used by Staff, the owner console (lib/owner-client.ts) and the lead workflow.
 */
import { DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";
import { browserAdminLocale } from "./i18n/config";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";

/** `t` in the language of the page the call is made from (English outside a browser). */
export const browserT = (): Translate => createTranslator(browserAdminLocale());

/** The API rules (error details `rule`) with their own message, keyed as `staff.api.rules.<rule>`. */
export const RULES = [
  "already_assigned",
  "self_grant",
  "reciprocal_grant",
  "membership_inactive",
  "scope_mismatch",
  "expiry_in_past",
  "already_ended",
  "assignee_inactive",
  "unknown_role",
  "db_guard",
  // DP-110: system owner console (ADR-018).
  "core_module",
  "reason_required",
  "already_designated",
  "not_eligible",
  // DP-041: lead sales workflow (ADR-019).
  "stale",
  "transition",
  "unchanged",
  "anonymised",
  "assignee_not_eligible",
  "future",
] as const;
export type ApiRule = (typeof RULES)[number];

const isRule = (rule: string): rule is ApiRule => (RULES as readonly string[]).includes(rule);

/** The message of an API rule in the UI language; undefined for a rule without its own text. */
export function ruleMessage(rule: string, t: Translate = browserT()): string | undefined {
  return isRule(rule) ? t(`staff.api.rules.${rule}`) : undefined;
}

/** The message of an API error code (the contract's codes, `errors.<CODE>`), else `fallback`. */
export function codeMessage(code: string | null, fallback: string, t: Translate): string {
  return code && code in DEFAULT_ERROR_MESSAGES
    ? t(`errors.${code as keyof typeof DEFAULT_ERROR_MESSAGES}`)
    : fallback;
}

/** English rule messages by rule (as before ML-12e; kept for callers that read the table). */
export const RULE_MESSAGES: Readonly<Record<string, string>> = Object.fromEntries(
  RULES.map((r) => [r, createTranslator("en")(`staff.api.rules.${r}`)]),
);

export type StaffCall<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; stepUp: boolean };

export async function postJson<T>(url: string, body?: unknown): Promise<StaffCall<T>> {
  const t = browserT();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: t("staff.api.unreachable"), stepUp: false };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const rule = parsed.success
    ? parsed.data.error.details
        .map((d) => (typeof d === "object" && d && "rule" in d ? String(d.rule) : ""))
        .find((r) => isRule(r))
    : undefined;
  const message =
    (rule && ruleMessage(rule, t)) ??
    (code === "FORBIDDEN"
      ? t("staff.api.forbidden")
      : codeMessage(code, t("staff.api.saveFailed"), t));
  return { ok: false, status: res.status, message, stepUp: code === "AUTH_STEP_UP_REQUIRED" };
}

export const assignRole = (
  userId: string,
  body: { roleKey: string; siteId?: string; expiresAt?: string },
) => postJson(`/api/v1/admin/staff/${encodeURIComponent(userId)}/roles`, body);
export const revokeRole = (assignmentId: string) =>
  postJson(`/api/v1/admin/role-assignments/${encodeURIComponent(assignmentId)}/revoke`, {});
export const inviteStaff = (body: {
  email: string;
  displayName: string;
  siteId: string;
  roleKey?: string;
}) => postJson<{ userId: string; enrolmentLink: string }>("/api/v1/admin/users/invite", body);
export const stepUp = (code: string) => postJson("/api/v1/auth/staff/step-up", { code });

/** End of the chosen day in Amsterdam is close enough for an optional end date: 23:59 UTC. */
export function endOfDayIso(date: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:00.000Z` : undefined;
}
