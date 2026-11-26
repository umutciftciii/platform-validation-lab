/**
 * DP-289: the adapters of the configured transport. `off`: none (every provider call is refused
 * with `transport_off`); `fake`: the deterministic fake; `live`: the real adapters over `fetch`.
 */
import type { AiProviderKey } from "@dream/contracts";
import type { AiTransport } from "../config/ai-config.js";
import { AnthropicAdapter } from "./anthropic.js";
import { FakeAdapter } from "./fake.js";
import { GeminiAdapter } from "./gemini.js";
import type { FetchLike } from "./http.js";
import { OpenAiAdapter } from "./openai.js";
import type { AiProviderAdapter } from "./types.js";

export type AdapterRegistry = ReadonlyMap<AiProviderKey, AiProviderAdapter>;

export function createAdapters(
  transport: AiTransport,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): AdapterRegistry {
  if (transport === "off") return new Map();
  if (transport === "fake") {
    return new Map(
      (["OPENAI", "ANTHROPIC", "GEMINI"] as const).map((p) => [p, new FakeAdapter(p)]),
    );
  }
  return new Map<AiProviderKey, AiProviderAdapter>([
    ["OPENAI", new OpenAiAdapter(fetchImpl)],
    ["ANTHROPIC", new AnthropicAdapter(fetchImpl)],
    ["GEMINI", new GeminiAdapter(fetchImpl)],
  ]);
}
