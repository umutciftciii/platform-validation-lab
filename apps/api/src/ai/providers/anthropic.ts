/**
 * DP-289: Anthropic (Claude) adapter (list/retrieve models). `GET /v1/models` (paged with
 * `limit`/`after_id`, `has_more`/`last_id`), `GET /v1/models/{model_id}`; as in the Models API
 * reference (read 2026-11-26): `Authorization: Bearer <key>`, `anthropic-version` (the versioning
 * page: it must be sent; 2026-10-21 is the latest listed version), optional
 * `anthropic-workspace-id`. Claude models are Messages models, so
 * every non-retired one is a text model; limits come from `max_input_tokens` / `max_tokens`.
 *
 * DP-291: generation over the Messages API (reference read 2026-11-26): `POST /v1/messages` with
 * `system`, one user message, `max_tokens` (thinking included). Version 2026-10-21 removed
 * `temperature`/`top_p`/`top_k` (400 on every model), so no temperature is ever sent. The text is
 * the `text` blocks of `content[]`; `stop_reason` gives the end. Usage: `input_tokens` excludes the
 * cache (`cache_read_input_tokens`, `cache_creation_input_tokens`); `output_tokens` is the billed
 * total (thinking included, `output_tokens_details.thinking_tokens`).
 */
import type { AiModelCapabilities } from "@dream/contracts";
import {
  errorFields,
  getJson,
  postJson,
  retryAfterSec,
  codeForStatus,
  type FetchLike,
} from "./http.js";
import {
  ProviderCallError,
  tokens,
  type AiProviderAdapter,
  type GenerateRequest,
  type GenerateResult,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

export function anthropicRequestBody(r: GenerateRequest): Record<string, unknown> {
  return {
    model: r.model,
    system: r.system,
    messages: [{ role: "user", content: r.input }],
    max_tokens: r.maxOutputTokens,
  };
}

/** The answer of `POST /v1/messages` in the common model. */
export function anthropicGeneration(raw: unknown): GenerateResult {
  if (!raw || typeof raw !== "object") throw new ProviderCallError("bad_response");
  const b = raw as Record<string, unknown>;
  const usage = (b["usage"] ?? {}) as Record<string, unknown>;
  const outDetails = (usage["output_tokens_details"] ?? {}) as Record<string, unknown>;
  const text = (Array.isArray(b["content"]) ? (b["content"] as unknown[]) : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => c["type"] === "text" && typeof c["text"] === "string")
    .map((c) => c["text"] as string)
    .join("");
  const stop = b["stop_reason"];
  const finish: GenerateResult["finish"] =
    stop === "end_turn" || stop === "stop_sequence"
      ? "complete"
      : stop === "max_tokens"
        ? "max_tokens"
        : stop === "refusal"
          ? "refused"
          : "incomplete";
  return {
    text,
    usage: {
      inputTokens: tokens(usage["input_tokens"]),
      cachedReadTokens: tokens(usage["cache_read_input_tokens"]),
      cacheWriteTokens: tokens(usage["cache_creation_input_tokens"]),
      outputTokens: tokens(usage["output_tokens"]),
      reasoningTokens: tokens(outDetails["thinking_tokens"]),
    },
    finish,
    providerRequestId: typeof b["id"] === "string" ? b["id"].slice(0, 200) : null,
  };
}

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
/** The latest version of the provider's versioning page (read 2026-11-26). */
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
      authorization: `Bearer ${apiKey}`,
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

  async generate(
    apiKey: string,
    request: GenerateRequest,
    o: ProviderCallOptions,
  ): Promise<GenerateResult> {
    const body = await postJson(
      this.fetchImpl,
      {
        url: `${ANTHROPIC_BASE_URL}/messages`,
        headers: this.headers(apiKey, o),
        signal: o.signal,
        body: anthropicRequestBody(request),
      },
      mapError,
    );
    return anthropicGeneration(body);
  }
}
