/**
 * DP-298 (ADR-031): browser calls of the data-processing screens, through the admin's same-origin
 * proxy — Content > Legal texts (`LEGAL_TEXTS_API`), the withdrawal of a lead's consent and the AI
 * providers' data-processing terms. Every call returns a `StaffCall`: a refusal carries its message
 * in the UI language (by the API's rule, else its code) and `stepUp: true` when the API wants a
 * fresh authenticator code (publishing, recording the legal review, recording or revoking terms);
 * the screen then asks for the code and retries (components/owner/owner-actions useStepUp).
 * `rule` and `status` let a screen react to a specific refusal (a stale draft: 409 `stale`).
 */
import {
  AI_API,
  ErrorBodySchema,
  LEGAL_TEXTS_API,
  type AiProviderDataTermsRequest,
  type AiProviderDataTermsResponse,
  type AiProviderKey,
  type ConsentPurpose,
  type ConsentWithdrawRequest,
  type LeadConsentsResponse,
  type LegalTextDraftCreateRequest,
  type LegalTextDraftUpdateRequest,
  type LegalTextVersionResponse,
} from "@dream/contracts";
import type { Translate } from "./i18n/types";
import { legalTextRuleMessage, parseLegalTextRule } from "./legal-texts-view";
import { browserT, codeMessage } from "./staff-client";

const CONSENT_RULES = ["not_granted", "anonymised", "db_guard"] as const;
const TERMS_RULES = ["no_terms"] as const;

export type DataProcessingCall<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; stepUp: boolean; rule: string | null };

/** The message of a refused call: its rule (legal texts, consents, AI terms), else its code. */
export function dataProcessingError(
  json: unknown,
  t: Translate,
): { message: string; stepUp: boolean; rule: string | null } {
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return { message: t("legal.texts.api.failed"), stepUp: false, rule: null };
  const { code, details } = parsed.data.error;
  const raw =
    details
      .map((d) => (typeof d === "object" && d && "rule" in d ? String(d.rule) : ""))
      .find((r) => r !== "") ?? null;
  const rule = raw === null ? null : parseLegalTextRule(raw).rule;
  let message: string | undefined;
  if (raw !== null) {
    if ((CONSENT_RULES as readonly string[]).includes(raw)) {
      message = t(`legal.consents.rules.${raw as (typeof CONSENT_RULES)[number]}`);
    } else if ((TERMS_RULES as readonly string[]).includes(raw)) {
      message = t(`legal.aiTerms.rules.${raw as (typeof TERMS_RULES)[number]}`);
    } else {
      message = legalTextRuleMessage(raw, t);
    }
  }
  message ??=
    code === "FORBIDDEN"
      ? t("legal.texts.api.forbidden")
      : codeMessage(code, t("legal.texts.api.failed"), t);
  return { message, stepUp: code === "AUTH_STEP_UP_REQUIRED", rule };
}

type Method = "GET" | "POST" | "DELETE";

async function call<T>(
  method: Method,
  url: string,
  body?: unknown,
): Promise<DataProcessingCall<T>> {
  const t = browserT();
  const withBody = method === "POST";
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(withBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(withBody ? { body: JSON.stringify(body ?? {}) } : {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: t("legal.texts.api.unreachable"),
      stepUp: false,
      rule: null,
    };
  }
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, ...dataProcessingError(json, t) };
}

const enc = encodeURIComponent;

// --- legal texts --------------------------------------------------------------------------------

export const getLegalTextVersion = (id: string) =>
  call<LegalTextVersionResponse>("GET", `${LEGAL_TEXTS_API}/versions/${enc(id)}`);

export const createLegalTextDraft = (body: LegalTextDraftCreateRequest) =>
  call<LegalTextVersionResponse>("POST", `${LEGAL_TEXTS_API}/drafts`, body);

export const updateLegalTextDraft = (id: string, body: LegalTextDraftUpdateRequest) =>
  call<LegalTextVersionResponse>("POST", `${LEGAL_TEXTS_API}/drafts/${enc(id)}`, body);

export const deleteLegalTextDraft = (id: string) =>
  call<null>("DELETE", `${LEGAL_TEXTS_API}/drafts/${enc(id)}`);

/** Publishes exactly the text the publisher read (its SHA-256); sensitive: step-up. */
export const publishLegalText = (id: string, sha256: string) =>
  call<LegalTextVersionResponse>("POST", `${LEGAL_TEXTS_API}/versions/${enc(id)}/publish`, {
    sha256,
  });

/** Records that a legal reviewer approved these exact words; sensitive: step-up. */
export const approveLegalReview = (id: string, sha256: string) =>
  call<LegalTextVersionResponse>("POST", `${LEGAL_TEXTS_API}/versions/${enc(id)}/legal-review`, {
    sha256,
  });

// --- lead consents ------------------------------------------------------------------------------

export const withdrawLeadConsent = (
  leadId: string,
  purpose: ConsentPurpose,
  body: ConsentWithdrawRequest,
) =>
  call<LeadConsentsResponse>(
    "POST",
    `/api/v1/admin/leads/${enc(leadId)}/consents/${enc(purpose)}/withdraw`,
    body,
  );

// --- AI provider data-processing terms ----------------------------------------------------------

export const recordAiDataTerms = (provider: AiProviderKey, body: AiProviderDataTermsRequest) =>
  call<AiProviderDataTermsResponse>(
    "POST",
    `${AI_API}/providers/${enc(provider)}/data-terms`,
    body,
  );

export const revokeAiDataTerms = (provider: AiProviderKey) =>
  call<AiProviderDataTermsResponse>(
    "POST",
    `${AI_API}/providers/${enc(provider)}/data-terms/revoke`,
  );
