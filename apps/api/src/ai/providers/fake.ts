/**
 * DP-289: the deterministic fake provider (DP_AI_TRANSPORT=fake: CI, fixtures). No network. The
 * key decides the outcome so tests can drive every path:
 *   contains "invalid"   → credential_invalid      contains "denied"  → permission_denied
 *   contains "ratelimit" → rate_limited             contains "quota"   → quota_exceeded
 *   contains "down"      → provider_unavailable     contains "timeout" → timeout
 * Otherwise it lists two models per provider: one compatible text model and one that is not
 * (an embedding model or a retired one).
 */
import type { AiProviderKey } from "@dream/contracts";
import { anthropicModel } from "./anthropic.js";
import { geminiModel } from "./gemini.js";
import { openAiModel } from "./openai.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

const OUTCOMES: [string, ProviderCallError["code"]][] = [
  ["invalid", "credential_invalid"],
  ["denied", "permission_denied"],
  ["ratelimit", "rate_limited"],
  ["quota", "quota_exceeded"],
  ["down", "provider_unavailable"],
  ["timeout", "timeout"],
];

const MODELS: Record<AiProviderKey, () => ProviderModel[]> = {
  OPENAI: () =>
    [openAiModel({ id: "gpt-fake-mini" }), openAiModel({ id: "text-embedding-fake" })].filter(
      (m): m is ProviderModel => m !== null,
    ),
  ANTHROPIC: () =>
    [
      anthropicModel({
        id: "claude-fake-sonnet",
        display_name: "Claude Fake Sonnet",
        max_input_tokens: 200000,
        max_tokens: 64000,
      }),
      anthropicModel({
        id: "claude-fake-retired",
        display_name: "Claude Fake (retired)",
        lifecycle: "retired",
      }),
    ].filter((m): m is ProviderModel => m !== null),
  GEMINI: () =>
    [
      geminiModel({
        name: "models/gemini-fake-flash",
        displayName: "Gemini Fake Flash",
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        supportedGenerationMethods: ["generateContent", "countTokens"],
        thinking: true,
      }),
      geminiModel({ name: "models/embedding-fake", supportedGenerationMethods: ["embedContent"] }),
    ].filter((m): m is ProviderModel => m !== null),
};

export class FakeAdapter implements AiProviderAdapter {
  readonly billingProfile: string;
  constructor(readonly provider: AiProviderKey) {
    this.billingProfile = `${provider.toLowerCase()}.fake`;
  }

  private check(apiKey: string, o: ProviderCallOptions): void {
    if (o.signal.aborted) throw new ProviderCallError("timeout");
    for (const [needle, code] of OUTCOMES) {
      if (apiKey.includes(needle))
        throw new ProviderCallError(code, null, code === "rate_limited" ? 30 : null);
    }
  }

  async listModels(apiKey: string, o: ProviderCallOptions): Promise<ProviderModel[]> {
    this.check(apiKey, o);
    return MODELS[this.provider]();
  }

  async getModel(
    apiKey: string,
    modelId: string,
    o: ProviderCallOptions,
  ): Promise<ProviderModel | null> {
    this.check(apiKey, o);
    return MODELS[this.provider]().find((m) => m.modelId === modelId) ?? null;
  }
}
