/**
 * DP-289: OpenAI adapter (list/retrieve models). `GET /v1/models`, `GET /v1/models/{model}`;
 * `Authorization: Bearer <key>`, optional `OpenAI-Project`. The answer says only id, owner and
 * shutdown date, so a model's capabilities stay UNKNOWN (null) — never guessed from its name —
 * and it is not `compatible` until an AI administrator verifies it and confirms it explicitly
 * (providers.service.ts). Only the lifecycle (from `shutdown_date`) is known.
 *
 * DP-291: generation over the Responses API (reference read 2026-11-26): `POST /v1/responses`
 * with `instructions` (system), `input` (string), `max_output_tokens` (reasoning included; at
 * least 16), `store: false`, `tool_choice: "none"` and no tools. The text is the `output_text`
 * parts of the `message` items of `output[]` (the `output_text` field is SDK-only). Usage:
 * `input_tokens` includes cache reads (`input_tokens_details.cached_tokens`) and cache writes
 * (`…cache_write_tokens`); `output_tokens` includes reasoning tokens.
 */
import type { AiModelCapabilities } from "@dream/contracts";
import {
  codeForStatus,
  errorFields,
  getJson,
  postJson,
  retryAfterSec,
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

/** The Responses API's smallest `max_output_tokens`. */
export const OPENAI_MIN_OUTPUT_TOKENS = 16;

export function openAiRequestBody(r: GenerateRequest): Record<string, unknown> {
  return {
    model: r.model,
    instructions: r.system,
    input: r.input,
    max_output_tokens: Math.max(OPENAI_MIN_OUTPUT_TOKENS, r.maxOutputTokens),
    store: false,
    tool_choice: "none",
    ...(r.temperature !== null ? { temperature: r.temperature } : {}),
  };
}

/** The answer of `POST /v1/responses` in the common model. */
export function openAiGeneration(raw: unknown): GenerateResult {
  if (!raw || typeof raw !== "object") throw new ProviderCallError("bad_response");
  const b = raw as Record<string, unknown>;
  const usage = (b["usage"] ?? {}) as Record<string, unknown>;
  const inDetails = (usage["input_tokens_details"] ?? {}) as Record<string, unknown>;
  const outDetails = (usage["output_tokens_details"] ?? {}) as Record<string, unknown>;
  const cached = tokens(inDetails["cached_tokens"]);
  const cacheWrite = tokens(inDetails["cache_write_tokens"]);
  const text = (Array.isArray(b["output"]) ? (b["output"] as unknown[]) : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .filter((i) => i["type"] === "message")
    .flatMap((i) => (Array.isArray(i["content"]) ? (i["content"] as unknown[]) : []))
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => c["type"] === "output_text" && typeof c["text"] === "string")
    .map((c) => c["text"] as string)
    .join("");
  const status = b["status"];
  const reason = ((b["incomplete_details"] ?? {}) as Record<string, unknown>)["reason"];
  const finish: GenerateResult["finish"] =
    status === "completed"
      ? "complete"
      : status === "incomplete" && reason === "max_output_tokens"
        ? "max_tokens"
        : status === "incomplete" && reason === "content_filter"
          ? "refused"
          : "incomplete";
  return {
    text,
    usage: {
      inputTokens: Math.max(0, tokens(usage["input_tokens"]) - cached - cacheWrite),
      cachedReadTokens: cached,
      cacheWriteTokens: cacheWrite,
      outputTokens: tokens(usage["output_tokens"]),
      reasoningTokens: tokens(outDetails["reasoning_tokens"]),
    },
    finish,
    providerRequestId: typeof b["id"] === "string" ? b["id"].slice(0, 200) : null,
  };
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAiModel {
  id?: unknown;
  shutdown_date?: unknown;
}

export function openAiModel(raw: OpenAiModel, now = Date.now()): ProviderModel | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  const id = raw.id;
  const shutdown = typeof raw.shutdown_date === "string" ? Date.parse(raw.shutdown_date) : NaN;
  const lifecycle: AiModelCapabilities["lifecycle"] = Number.isNaN(shutdown)
    ? "active"
    : shutdown <= now
      ? "retired"
      : "deprecated";
  return {
    modelId: id,
    displayName: id,
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: { textGeneration: null, structuredOutput: null, thinking: null, lifecycle },
    // Unknown is not compatible: only the administrator's confirmation makes it usable.
    compatible: false,
  };
}

async function mapError(res: Response): Promise<ProviderCallError> {
  const f = await errorFields(res);
  if (res.status === 429) {
    if (/quota|spend_limit|credit_balance|usage_limit/.test(`${f.code} ${f.type}`)) {
      return new ProviderCallError("quota_exceeded", 429);
    }
    return new ProviderCallError("rate_limited", 429, retryAfterSec(res));
  }
  return new ProviderCallError(codeForStatus(res.status), res.status);
}

export class OpenAiAdapter implements AiProviderAdapter {
  readonly provider = "OPENAI" as const;
  readonly billingProfile = "openai.responses";
  constructor(private readonly fetchImpl: FetchLike) {}

  private headers(apiKey: string, o: ProviderCallOptions): Record<string, string> {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(o.projectRef ? { "openai-project": o.projectRef } : {}),
    };
  }

  async listModels(apiKey: string, o: ProviderCallOptions): Promise<ProviderModel[]> {
    const body = await getJson(
      this.fetchImpl,
      { url: `${OPENAI_BASE_URL}/models`, headers: this.headers(apiKey, o), signal: o.signal },
      mapError,
    );
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) throw new ProviderCallError("bad_response");
    return data
      .map((m) => openAiModel(m as OpenAiModel))
      .filter((m): m is ProviderModel => m !== null);
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
          url: `${OPENAI_BASE_URL}/models/${encodeURIComponent(modelId)}`,
          headers: this.headers(apiKey, o),
          signal: o.signal,
        },
        mapError,
      );
      return openAiModel(body as OpenAiModel);
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
        url: `${OPENAI_BASE_URL}/responses`,
        headers: this.headers(apiKey, o),
        signal: o.signal,
        ...(o.onDispatch ? { onDispatch: o.onDispatch } : {}),
        body: openAiRequestBody(request),
      },
      mapError,
    );
    return openAiGeneration(body);
  }
}
