/**
 * DP-289: the deterministic fake provider (DP_AI_TRANSPORT=fake: CI, fixtures). No network. The
 * key decides the outcome so tests can drive every path:
 *   contains "invalid"   → credential_invalid      contains "denied"  → permission_denied
 *   contains "ratelimit" → rate_limited             contains "quota"   → quota_exceeded
 *   contains "down"      → provider_unavailable     contains "timeout" → timeout
 * Otherwise it lists two models per provider: one compatible text model and one that is not
 * (an embedding model or a retired one).
 *
 * DP-291: `generate` answers "pong" with a deterministic usage (no network, no cost). Directives in
 * the INPUT drive the other paths (tests only):
 *   [fake:delay=<ms>]     wait (honours the abort signal → timeout)
 *   [fake:error=<code>]   throw that ProviderCallError code
 *   [fake:refuse]         a refusal          [fake:max_tokens]  stopped at the output cap
 *   [fake:overrun]        report twice the output cap (an estimate underrun)
 * `FakeAdapter.generateCalls` counts every generation started in this process. DP-297: with
 * DP_AI_FAKE_CALL_LOG set (multi-process tests only), every generation also appends the SHA-256 of
 * its input (never the text) to that file, so tests count calls across API processes.
 */
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { anthropicModel } from "./anthropic.js";
import { geminiModel } from "./gemini.js";
import { openAiModel } from "./openai.js";
import {
  AI_PROVIDER_RESULT_CODES,
  type AiProviderKey,
  type AiProviderResultCode,
} from "@dream/contracts";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type GenerateRequest,
  type GenerateResult,
  type ProviderCallOptions,
  type ProviderModel,
} from "./types.js";

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderCallError("timeout"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderCallError("timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
  /** Generations started in this process (all fake providers). */
  static generateCalls = 0;
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

  async generate(
    apiKey: string,
    r: GenerateRequest,
    o: ProviderCallOptions,
  ): Promise<GenerateResult> {
    this.check(apiKey, o);
    FakeAdapter.generateCalls++;
    const callLog = process.env["DP_AI_FAKE_CALL_LOG"];
    if (callLog) {
      appendFileSync(callLog, `${createHash("sha256").update(r.input).digest("hex")}\n`);
    }
    // The fake "request" is with the provider from here (DP-297 dispatch hand-off).
    o.onDispatch?.();
    const wait = /\[fake:delay=(\d{1,5})\]/.exec(r.input);
    if (wait) await delay(Number(wait[1]), o.signal);
    if (o.signal.aborted) throw new ProviderCallError("timeout");
    const err = /\[fake:error=([a-z_]+)\]/.exec(r.input)?.[1];
    if (err && err !== "ok" && (AI_PROVIDER_RESULT_CODES as readonly string[]).includes(err)) {
      throw new ProviderCallError(err as Exclude<AiProviderResultCode, "ok">);
    }
    const bytes = Buffer.byteLength(r.system, "utf8") + Buffer.byteLength(r.input, "utf8");
    const refused = r.input.includes("[fake:refuse]");
    const capped = r.input.includes("[fake:max_tokens]");
    const output = r.input.includes("[fake:overrun]")
      ? r.maxOutputTokens * 2
      : capped
        ? r.maxOutputTokens
        : Math.min(r.maxOutputTokens, 2);
    return {
      text: refused ? "" : "pong",
      usage: {
        inputTokens: Math.ceil(bytes / 4),
        cachedReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: output,
        reasoningTokens: 0,
      },
      finish: refused ? "refused" : capped ? "max_tokens" : "complete",
      providerRequestId: `fake-${this.provider.toLowerCase()}-${FakeAdapter.generateCalls}`,
    };
  }
}
