/**
 * Staff and role administration from the browser (DP-076 revision, DP-107; ADR-017 v2), through
 * the admin's same-origin proxy. A call answering AUTH_STEP_UP_REQUIRED (user invitations keep
 * their step-up) returns `stepUp: true` so the form can ask for an authenticator code.
 */
import { DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";

export const RULE_MESSAGES: Readonly<Record<string, string>> = {
  already_assigned: "This person already has this role there.",
  self_grant: "You cannot change your own roles.",
  reciprocal_grant: "You cannot give a role to someone who gave you yours.",
  membership_inactive: "This person's access to that site is suspended. Reactivate it first.",
  scope_mismatch: "Choose a site for a site role, none for a platform role.",
  expiry_in_past: "The end date must be in the future.",
  already_ended: "This role has already ended. Reload the page.",
  assignee_inactive: "This account is closed.",
  unknown_role: "Unknown role.",
  db_guard: "The database refused this change. Reload the page and try again.",
  // DP-110: system owner console (ADR-018).
  core_module: "Core modules are always on and cannot be switched off.",
  reason_required: "Give a reason for the change.",
  already_designated: "A system owner is already designated. It cannot be changed.",
  not_eligible: "This account cannot become the owner (it needs a password and an authenticator).",
  // DP-041: lead sales workflow (ADR-019).
  stale: "Someone else changed this lead meanwhile. Reload the page and try again.",
  transition: "This status change is not allowed from the current status.",
  unchanged: "Nothing to change.",
  anonymised: "This lead is anonymised and cannot change.",
  assignee_not_eligible: "This person cannot work leads of this site.",
  future: "The contact cannot be in the future.",
};

export type StaffCall<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; stepUp: boolean };

export async function postJson<T>(url: string, body?: unknown): Promise<StaffCall<T>> {
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
    return { ok: false, status: 0, message: "The admin API cannot be reached.", stepUp: false };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const rule = parsed.success
    ? parsed.data.error.details
        .map((d) => (typeof d === "object" && d && "rule" in d ? String(d.rule) : ""))
        .find((r) => r in RULE_MESSAGES)
    : undefined;
  const message =
    (rule && RULE_MESSAGES[rule]) ??
    (code === "FORBIDDEN"
      ? "You may not make this change (it needs permissions you do not hold, or another site)."
      : code && code in DEFAULT_ERROR_MESSAGES
        ? DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES]
        : "The change could not be saved. Try again in a moment.");
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
