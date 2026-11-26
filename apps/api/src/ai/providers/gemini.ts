/**
 * DP-289: Google Gemini API adapter (list/retrieve models). As in the models.list reference (read
 * 2026-11-26): `GET https://generativelanguage.googleapis.com/v1beta/models`, `pageSize` (at most
 * 1000 per page), `pageToken`, answer `models[]` and `nextPageToken` (absent on the last page);
 * `GET /v1beta/models/{model}`. The reference example passes `?key=`; the platform passes the key
 * ONLY in the `x-goog-api-key` header documented on the API-key page (a key in a URL ends up in
 * logs). A model is a text model when it supports
 * `generateContent`; limits from `inputTokenLimit` / `outputTokenLimit`; `thinking` as reported.
 */
import { errorFields, getJson, retryAfterSec, codeForStatus, type FetchLike } from "./http.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const PAGE = 1000;
const MAX_PAGES = 5;

interface GeminiModel {
  name?: unknown;
  displayName?: unknown;
  inputTokenLimit?: unknown;
  outputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
  thinking?: unknown;
}

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function geminiModel(raw: GeminiModel): ProviderModel | null {
  if (typeof raw.name !== "string" || !raw.name.startsWith("models/")) return null;
  const id = raw.name.slice("models/".length);
  if (!id) return null;
  const methods = Array.isArray(raw.supportedGenerationMethods)
    ? raw.supportedGenerationMethods.filter((m): m is string => typeof m === "string")
    : [];
  // The documented field decides, not the model's name.
  const textGeneration = methods.includes("generateContent");
  return {
    modelId: id,
    displayName: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : id,
    contextWindow: int(raw.inputTokenLimit),
    maxOutputTokens: int(raw.outputTokenLimit),
    capabilities: {
      textGeneration,
      structuredOutput: textGeneration ? true : null,
      thinking: typeof raw.thinking === "boolean" ? raw.thinking : null,
      lifecycle: null,
    },
    compatible: textGeneration,
  };
}

async function mapError(res: Response): Promise<ProviderCallError> {
  const f = await errorFields(res);
  if (f.reasons.includes("API_KEY_INVALID") || res.status === 401) {
    return new ProviderCallError("credential_invalid", res.status);
  }
  if (res.status === 429) {
    return f.code === "quota_exceeded"
      ? new ProviderCallError("quota_exceeded", 429)
      : new ProviderCallError("rate_limited", 429, retryAfterSec(res));
  }
  return new ProviderCallError(codeForStatus(res.status), res.status);
}

export class GeminiAdapter implements AiProviderAdapter {
  readonly provider = "GEMINI" as const;
  readonly billingProfile = "gemini.generate";
  constructor(private readonly fetchImpl: FetchLike) {}

  private headers(apiKey: string): Record<string, string> {
    return { "x-goog-api-key": apiKey };
  }

  async listModels(apiKey: string, o: ProviderCallOptions): Promise<ProviderModel[]> {
    const out: ProviderModel[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q: string = `pageSize=${PAGE}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      const body = (await getJson(
        this.fetchImpl,
        { url: `${GEMINI_BASE_URL}/models?${q}`, headers: this.headers(apiKey), signal: o.signal },
        mapError,
      )) as { models?: unknown; nextPageToken?: unknown };
      if (!Array.isArray(body.models)) throw new ProviderCallError("bad_response");
      for (const m of body.models) {
        const model = geminiModel(m as GeminiModel);
        if (model) out.push(model);
      }
      if (typeof body.nextPageToken !== "string" || !body.nextPageToken) return out;
      token = body.nextPageToken;
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
          url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelId)}`,
          headers: this.headers(apiKey),
          signal: o.signal,
        },
        mapError,
      );
      return geminiModel(body as GeminiModel);
    } catch (error) {
      if (error instanceof ProviderCallError && error.code === "model_not_found") return null;
      throw error;
    }
  }
}
