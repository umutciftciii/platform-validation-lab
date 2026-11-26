/**
 * DP-289: OpenAI adapter (list/retrieve models). `GET /v1/models`, `GET /v1/models/{model}`;
 * `Authorization: Bearer <key>`, optional `OpenAI-Project`. The answer says only id, owner and
 * shutdown date, so a model's capabilities stay UNKNOWN (null) — never guessed from its name —
 * and it is not `compatible` until an AI administrator verifies it and confirms it explicitly
 * (providers.service.ts). Only the lifecycle (from `shutdown_date`) is known.
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
}
