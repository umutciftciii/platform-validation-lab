/**
 * DP-289: OpenAI adapter (list/retrieve models). `GET /v1/models`, `GET /v1/models/{model}`;
 * `Authorization: Bearer <key>`, optional `OpenAI-Project`. The list has no paging and says
 * little about a model (id, owner, shutdown date), so text capability is derived from the id
 * family; context and output limits stay unknown.
 */
import type { AiModelCapabilities } from "@dream/contracts";
import { codeForStatus, errorFields, getJson, retryAfterSec, type FetchLike } from "./http.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const TEXT_FAMILY = /^(gpt-|o\d|chatgpt-)/;
const NOT_TEXT = /(embed|tts|whisper|transcri|audio|realtime|image|dall-e|moderation|sora|search)/;

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
  const textGeneration = TEXT_FAMILY.test(id) && !NOT_TEXT.test(id);
  return {
    modelId: id,
    displayName: id,
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: { textGeneration, structuredOutput: null, thinking: null, lifecycle },
    compatible: textGeneration && lifecycle !== "retired",
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
}
