/**
 * DP-289: Anthropic (Claude) adapter (list/retrieve models). `GET /v1/models` (paged with
 * `limit`/`after_id`, `has_more`/`last_id`), `GET /v1/models/{model_id}`; `x-api-key`,
 * `anthropic-version`, optional `anthropic-workspace-id`. Claude models are Messages models, so
 * every non-retired one is a text model; limits come from `max_input_tokens` / `max_tokens`.
 */
import type { AiModelCapabilities } from "@dream/contracts";
import { errorFields, getJson, retryAfterSec, codeForStatus, type FetchLike } from "./http.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
/** The version the provider's reference examples use (read 2026-11-26). */
export const ANTHROPIC_VERSION = "2026-10-21";
const PAGE = 1000;
const MAX_PAGES = 5;

interface AnthropicModel {
  id?: unknown;
  display_name?: unknown;
  max_input_tokens?: unknown;
  max_tokens?: unknown;
  lifecycle?: unknown;
  capabilities?: unknown;
}

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function anthropicModel(raw: AnthropicModel): ProviderModel | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  const lifecycle: AiModelCapabilities["lifecycle"] =
    raw.lifecycle === "deprecated" || raw.lifecycle === "retired" ? raw.lifecycle : "active";
  const caps = raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {};
  const flag = (re: RegExp) => {
    const keys = Object.keys(caps).filter((k) => re.test(k));
    if (keys.length === 0) return null;
    return keys.some((k) => {
      const v = (caps as Record<string, unknown>)[k];
      return (
        v === true ||
        (v !== null && typeof v === "object" && (v as { supported?: unknown }).supported === true)
      );
    });
  };
  return {
    modelId: raw.id,
    displayName:
      typeof raw.display_name === "string" && raw.display_name ? raw.display_name : raw.id,
    contextWindow: int(raw.max_input_tokens),
    maxOutputTokens: int(raw.max_tokens),
    capabilities: {
      textGeneration: true,
      structuredOutput: flag(/structured|json/i),
      thinking: flag(/thinking/i),
      lifecycle,
    },
    compatible: lifecycle !== "retired",
  };
}

async function mapError(res: Response): Promise<ProviderCallError> {
  const f = await errorFields(res);
  switch (f.type) {
    case "authentication_error":
      return new ProviderCallError("credential_invalid", res.status);
    case "permission_error":
      return new ProviderCallError("permission_denied", res.status);
    case "not_found_error":
      return new ProviderCallError("model_not_found", res.status);
    case "billing_error":
      return new ProviderCallError("quota_exceeded", res.status);
    case "rate_limit_error": {
      // A spend-cap 429 has no Retry-After and keeps failing: quota, not a short wait.
      const wait = retryAfterSec(res);
      return wait === null
        ? new ProviderCallError("quota_exceeded", res.status)
        : new ProviderCallError("rate_limited", res.status, wait);
    }
    case "overloaded_error":
    case "api_error":
      return new ProviderCallError("provider_unavailable", res.status);
    case "timeout_error":
      return new ProviderCallError("timeout", res.status);
    default:
      if (res.status === 529) return new ProviderCallError("provider_unavailable", 529);
      return new ProviderCallError(codeForStatus(res.status), res.status, retryAfterSec(res));
  }
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly provider = "ANTHROPIC" as const;
  readonly billingProfile = "anthropic.messages";
  constructor(private readonly fetchImpl: FetchLike) {}

  private headers(apiKey: string, o: ProviderCallOptions): Record<string, string> {
    return {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      ...(o.projectRef ? { "anthropic-workspace-id": o.projectRef } : {}),
    };
  }

  async listModels(apiKey: string, o: ProviderCallOptions): Promise<ProviderModel[]> {
    const out: ProviderModel[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q: string = `limit=${PAGE}${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
      const body = (await getJson(
        this.fetchImpl,
        {
          url: `${ANTHROPIC_BASE_URL}/models?${q}`,
          headers: this.headers(apiKey, o),
          signal: o.signal,
        },
        mapError,
      )) as { data?: unknown; has_more?: unknown; last_id?: unknown };
      if (!Array.isArray(body.data)) throw new ProviderCallError("bad_response");
      for (const m of body.data) {
        const model = anthropicModel(m as AnthropicModel);
        if (model) out.push(model);
      }
      if (body.has_more !== true || typeof body.last_id !== "string") return out;
      after = body.last_id;
    }
    return out;
  }

  async getModel(
    apiKey: string,
    modelId: string,
    o: ProviderCallOptions,
  ): Promise<ProviderModel | null> {
    try {
      const body = await getJson(
        this.fetchImpl,
        {
          url: `${ANTHROPIC_BASE_URL}/models/${encodeURIComponent(modelId)}`,
          headers: this.headers(apiKey, o),
          signal: o.signal,
        },
        mapError,
      );
      return anthropicModel(body as AnthropicModel);
    } catch (error) {
      if (error instanceof ProviderCallError && error.code === "model_not_found") return null;
      throw error;
    }
  }
}
