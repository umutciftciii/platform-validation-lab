/**
 * System owner console calls from the browser (DP-110, ADR-018), through the admin's same-origin
 * proxy. Module switches, the protected audit trail and its verification need a fresh MFA step-up:
 * such a call returns `stepUp: true` so the component can ask for an authenticator code. Owner
 * refusals (core module, already designated, …) are mapped in staff-client's RULE_MESSAGES.
 */
import {
  DEFAULT_ERROR_MESSAGES,
  ErrorBodySchema,
  OWNER_API,
  type OwnerChainStatus,
  type OwnerDesignationConfirmResponse,
  type OwnerModuleChangeResponse,
  type ProtectedAuditListResponse,
} from "@dream/contracts";
import { postJson, type StaffCall } from "./staff-client";

/** GET through the proxy with the same error mapping as `postJson`. */
export async function getJson<T>(url: string): Promise<StaffCall<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "The admin API cannot be reached.", stepUp: false };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const message =
    code && code in DEFAULT_ERROR_MESSAGES
      ? DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES]
      : "The request failed. Try again in a moment.";
  return { ok: false, status: res.status, message, stepUp: code === "AUTH_STEP_UP_REQUIRED" };
}

export const changeModule = (moduleKey: string, siteId: string, enabled: boolean, reason: string) =>
  postJson<OwnerModuleChangeResponse>(
    `${OWNER_API}/modules/${encodeURIComponent(moduleKey)}/sites/${encodeURIComponent(siteId)}`,
    { enabled, reason },
  );

export const verifyChain = () => getJson<OwnerChainStatus>(`${OWNER_API}/audit/verify`);

export const protectedAudit = (before?: number) =>
  getJson<ProtectedAuditListResponse>(
    `${OWNER_API}/audit?limit=50${before ? `&before=${before}` : ""}`,
  );

export const confirmDesignation = (token: string, password: string) =>
  postJson<OwnerDesignationConfirmResponse>(`${OWNER_API}/designation/confirm`, {
    token,
    password,
  });
