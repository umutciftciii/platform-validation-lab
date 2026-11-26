/**
 * DP-292 (ADR-030): AI Center calls from the browser, through the admin's same-origin proxy. Every
 * management call may answer "step-up required" (`stepUp: true`): the screen asks for an
 * authenticator code and retries. API refusals are shown by their rule in the UI language
 * (`ai.rules.<rule>`); a provider's result code by `ai.results.<code>`; nothing else of an answer
 * is shown. An API key is sent once, in a POST body, and never kept by the page.
 */
import {
  AI_API,
  ErrorBodySchema,
  type AiBudget,
  type AiBudgetCreateRequest,
  type AiBudgetUpdateRequest,
  type AiReconciliationCreateRequest,
  type AiSettingsDto,
  type AiCredentialAddRequest,
  type AiCredentialResult,
  type AiCredentialSummary,
  type AiModelRefreshResponse,
  type AiModelSummary,
  type AiPrice,
  type AiPriceCreateRequest,
  type AiProviderKey,
  type AiProviderSettingRequest,
  type AiProviderSummary,
  type AiTaskSettingDto,
  type AiTaskSettingRequest,
  type AiTaskTypeKey,
} from "@dream/contracts";
import type { Translate } from "./i18n/types";
import { browserT, codeMessage, type StaffCall } from "./staff-client";

/** API rules of the AI Center with their own message (`ai.rules.<rule>`). */
export const AI_RULES = [
  "transport_off",
  "stale_version",
  "revoked",
  "not_verified",
  "no_active_credential",
  "price_missing",
  "price_exists",
  "model_required",
  "model_of_other_provider",
  "model_not_enabled",
  "incompatible",
  "duplicate_key",
  "default_model_required",
  "capabilities_unknown",
  "task_not_available",
  "task_disabled",
  "key_format",
  // DP-293: budgets, settings, reconciliation, reports.
  "budget_exists",
  "unknown_site",
  "platform_has_no_site",
  "already_recorded",
  "future",
  "too_many_operations",
] as const;
export type AiRule = (typeof AI_RULES)[number];
const isAiRule = (rule: string): rule is AiRule => (AI_RULES as readonly string[]).includes(rule);

/** The message of a refused AI call: its rule, else its code, else `fallback`. */
export function aiErrorMessage(
  json: unknown,
  t: Translate,
  fallback: string,
): {
  message: string;
  stepUp: boolean;
} {
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return { message: fallback, stepUp: false };
  const { code, details } = parsed.data.error;
  const rule = details
    .map((d) => (typeof d === "object" && d && "rule" in d ? String(d.rule) : ""))
    .find(isAiRule);
  const message = rule
    ? t(`ai.rules.${rule}`)
    : code === "FORBIDDEN"
      ? t("ai.api.forbidden")
      : codeMessage(code, fallback, t);
  return { message, stepUp: code === "AUTH_STEP_UP_REQUIRED" };
}

async function call<T>(method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const t = browserT();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: t("ai.api.unreachable"), stepUp: false } as const;
  }
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T } as const;
  return { ok: false, status: res.status, ...aiErrorMessage(json, t, t("ai.api.failed")) } as const;
}

const enc = encodeURIComponent;
export type AiCall<T> = StaffCall<T>;

export const addCredential = (provider: AiProviderKey, body: AiCredentialAddRequest) =>
  call<AiCredentialResult>("POST", `${AI_API}/providers/${enc(provider)}/credentials`, body);
export const testCredential = (id: string) =>
  call<AiCredentialResult>("POST", `${AI_API}/credentials/${enc(id)}/test`);
export const activateCredential = (id: string) =>
  call<AiCredentialSummary>("POST", `${AI_API}/credentials/${enc(id)}/activate`);
export const disableCredential = (id: string) =>
  call<AiCredentialSummary>("POST", `${AI_API}/credentials/${enc(id)}/disable`);
export const revokeCredential = (id: string) =>
  call<AiCredentialSummary>("DELETE", `${AI_API}/credentials/${enc(id)}`);
export const updateProvider = (provider: AiProviderKey, body: AiProviderSettingRequest) =>
  call<AiProviderSummary>("POST", `${AI_API}/providers/${enc(provider)}/settings`, body);

export const refreshModels = (provider: AiProviderKey) =>
  call<AiModelRefreshResponse>("POST", `${AI_API}/providers/${enc(provider)}/models/refresh`);
export const verifyModel = (id: string) =>
  call<AiModelSummary>("POST", `${AI_API}/models/${enc(id)}/verify`);
export const enableModel = (id: string, confirmUnknownCapabilities: boolean) =>
  call<AiModelSummary>("POST", `${AI_API}/models/${enc(id)}/enable`, {
    ...(confirmUnknownCapabilities ? { confirmUnknownCapabilities: true } : {}),
  });
export const disableModel = (id: string) =>
  call<AiModelSummary>("POST", `${AI_API}/models/${enc(id)}/disable`);
export const addPrice = (modelId: string, body: AiPriceCreateRequest) =>
  call<AiPrice>("POST", `${AI_API}/models/${enc(modelId)}/prices`, body);

export const updateTask = (task: AiTaskTypeKey, body: AiTaskSettingRequest) =>
  call<AiTaskSettingDto>("POST", `${AI_API}/tasks/${enc(task.toLowerCase())}`, body);

// --- DP-293: budgets, engine settings, provider figures (each a management change: step-up) ---

export const createBudget = (body: AiBudgetCreateRequest) =>
  call<AiBudget>("POST", `${AI_API}/budgets`, body);
export const updateBudget = (id: string, body: AiBudgetUpdateRequest) =>
  call<AiBudget>("POST", `${AI_API}/budgets/${enc(id)}`, body);
export const updateSettings = (body: AiSettingsDto) =>
  call<AiSettingsDto>("POST", `${AI_API}/settings`, body);
export const recordProviderFigure = (body: AiReconciliationCreateRequest) =>
  call<{ recorded: true }>("POST", `${AI_API}/reconciliation`, body);
