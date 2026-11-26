/**
 * DP-289 (ADR-030 D4): the common provider adapter interface. AI-1 lists and retrieves models
 * only (free provider endpoints, no generation, no cost); generation is added with DP-291.
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
}

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
