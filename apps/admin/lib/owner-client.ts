/**
 * System owner console calls from the browser (DP-110, ADR-018), through the admin's same-origin
 * proxy. Module switches, the protected audit trail and its verification need a fresh MFA step-up:
 * such a call returns `stepUp: true` so the component can ask for an authenticator code. Owner
 * refusals (core module, already designated, …) are mapped in staff-client's RULE_MESSAGES.
 *
 * ML-12e (DP-243): the messages are in the admin UI language (`browserT`, as staff-client);
 * request paths, bodies and every API code are unchanged. Module names are translated by the
 * module's key; an unknown key keeps the API's text.
 */
import {
  ErrorBodySchema,
  OWNER_API,
  type OwnerChainStatus,
  type OwnerDesignationConfirmResponse,
  type OwnerModuleChangeResponse,
  type ProtectedAuditListResponse,
} from "@dream/contracts";
import type { Translate } from "./i18n/types";
import { browserT, codeMessage, postJson, type StaffCall } from "./staff-client";

/** Module keys with their own name and description (`owner.modules.<key>`). */
const MODULE_KEYS = [
  "rbac",
  "audit",
  "mfa",
  "platform",
  "cms",
  "catalog",
  "leads",
  "membership",
  "crm",
  "automation",
  "integrations",
  "customer_portal",
] as const;
type ModuleKey = (typeof MODULE_KEYS)[number];
const isModuleKey = (key: string): key is ModuleKey =>
  (MODULE_KEYS as readonly string[]).includes(key);

/** A module's name in the UI language; the API's name for a module without its own text. */
export function ownerModuleName(module: { key: string; name: string }, t: Translate): string {
  return isModuleKey(module.key) ? t(`owner.modules.${module.key}.name`) : module.name;
}

/** A module's description in the UI language; the API's text for an unknown module. */
export function ownerModuleDescription(
  module: { key: string; description: string },
  t: Translate,
): string {
  return isModuleKey(module.key)
    ? t(`owner.modules.${module.key}.description`)
    : module.description;
}

/** GET through the proxy with the same error mapping as `postJson`. */
export async function getJson<T>(url: string): Promise<StaffCall<T>> {
  const t = browserT();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: t("owner.api.unreachable"), stepUp: false };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = codeMessage(code, t("owner.api.failed"), t);
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
