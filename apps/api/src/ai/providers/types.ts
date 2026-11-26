/**
 * DP-289 (ADR-030 D4): the common provider adapter interface: list/retrieve models (free provider
 * endpoints). DP-291: text generation (`generate`, a paid call), one request, never retried.
 *
 * Rules every adapter keeps:
 *  - the API key is passed in a request header, never in a URL (URLs are logged by proxies);
 *  - the base URL is a constant of the adapter (no user-supplied URL: no SSRF);
 *  - a provider's error text is never returned, logged or stored: failures become one of
 *    AI_PROVIDER_RESULT_CODES (contracts);
 *  - every call has a deadline (`ProviderCallOptions.signal`) and a response size limit.
 */
import type { AiModelCapabilities, AiProviderKey, AiProviderResultCode } from "@dream/contracts";

export interface ProviderModel {
  /** The provider's model id (Gemini without the `models/` prefix). */
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: AiModelCapabilities;
  /** Text generation and not retired. */
  compatible: boolean;
}

export interface ProviderCallOptions {
  /** OpenAI-Project / anthropic-workspace-id / (unused for Gemini). */
  projectRef?: string | null;
  signal: AbortSignal;
  /**
   * DP-297: called synchronously right after the provider request was handed to the transport
   * (fetch invoked), once. The worker keeps the AI switch until then (ADR-030 D10).
   */
  onDispatch?: () => void;
}

export interface AiProviderAdapter {
  readonly provider: AiProviderKey;
  /** The billing profile models of this adapter get (ADR-030 D6). */
  readonly billingProfile: string;
  listModels(apiKey: string, options: ProviderCallOptions): Promise<ProviderModel[]>;
  /** Null when the provider does not know the model (404). */
  getModel(
    apiKey: string,
    modelId: string,
    options: ProviderCallOptions,
  ): Promise<ProviderModel | null>;
  /**
   * DP-291: one text generation. Never retried (a paid call): a timeout, a lost connection or an
   * unreadable answer is thrown as an UNCERTAIN code (the provider may have billed it); a refusal
   * of the provider before work (4xx, 5xx) as a definite one (see `isUncertain`).
   */
  generate(
    apiKey: string,
    request: GenerateRequest,
    options: ProviderCallOptions,
  ): Promise<GenerateResult>;
}

/** DP-291: one generation request. Tools, web search and storage are always off. */
export interface GenerateRequest {
  /** The provider's model id. */
  model: string;
  system: string;
  input: string;
  /** The output cap sent to the provider (reasoning/thinking included where the provider does). */
  maxOutputTokens: number;
  /** Gemini only: the explicit thinking budget (0 = off where the model allows it). */
  thinkingBudget: number;
  /** 0…2 or null for the provider default. */
  temperature: number | null;
}

/**
 * DP-291 (ADR-030 D6): the provider's usage in the common model.
 *  - inputTokens: billed input WITHOUT cache reads and cache writes;
 *  - cachedReadTokens / cacheWriteTokens: cache reads / writes (each at its price);
 *  - outputTokens: billed output, reasoning/thinking INCLUDED;
 *  - reasoningTokens: the reasoning/thinking part of outputTokens (information only).
 */
export interface NormalizedUsage {
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export type GenerateFinish =
  /** A complete answer. */
  | "complete"
  /** Stopped at the output cap. */
  | "max_tokens"
  /** The provider refused or blocked it (safety). */
  | "refused"
  /** Any other incomplete end. */
  | "incomplete";

export interface GenerateResult {
  /** The answer's text (never logged or stored by the API). */
  text: string;
  usage: NormalizedUsage;
  finish: GenerateFinish;
  /** The provider's response/request id (support cases), if any. */
  providerRequestId: string | null;
}

/**
 * Codes after which the provider may have done (and billed) the work: the outcome is UNKNOWN,
 * the reservation is counted as spent and the call is never repeated automatically.
 */
export const UNCERTAIN_CODES: ReadonlySet<ProviderCallError["code"]> = new Set([
  "timeout",
  "network_error",
  "bad_response",
]);
export const isUncertain = (code: ProviderCallError["code"]) => UNCERTAIN_CODES.has(code);

const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
/** A provider's token count: a non-negative integer, anything else is 0. */
export const tokens = count;

/** A failed provider call, reduced to a code (never the provider's message). */
export class ProviderCallError extends Error {
  override name = "ProviderCallError";
  constructor(
    readonly code: Exclude<AiProviderResultCode, "ok">,
    readonly status: number | null = null,
    readonly retryAfterSec: number | null = null,
  ) {
    super(code);
  }
}

export const NO_CAPABILITIES: AiModelCapabilities = {
  textGeneration: false,
  structuredOutput: null,
  thinking: null,
  lifecycle: null,
};
