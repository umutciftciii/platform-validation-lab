/**
 * DP-289: what a provider's API key must look like before it is stored, and the hint shown in
 * its place. The check only refuses obvious mistakes (another provider's key, spaces, a pasted
 * header); the connection test decides whether the key works.
 */
import type { AiProviderKey } from "@dream/contracts";

const FORMATS: Record<AiProviderKey, { prefix: RegExp; hintPrefix: (key: string) => string }> = {
  OPENAI: {
    prefix: /^sk-(?!ant-)[A-Za-z0-9_-]{16,}$/,
    hintPrefix: (k) => (k.startsWith("sk-proj-") ? "sk-proj-" : "sk-"),
  },
  ANTHROPIC: { prefix: /^sk-ant-[A-Za-z0-9_-]{16,}$/, hintPrefix: () => "sk-ant-" },
  GEMINI: { prefix: /^AIza[A-Za-z0-9_-]{30,}$/, hintPrefix: () => "AIza" },
};

/** Null when the key looks like a key of this provider; otherwise the reason code. */
export function keyFormatProblem(provider: AiProviderKey, apiKey: string): "key_format" | null {
  return FORMATS[provider].prefix.test(apiKey) ? null : "key_format";
}

/** The provider prefix and the last four characters (at most 16 characters). */
export function keyHint(provider: AiProviderKey, apiKey: string): string {
  return `${FORMATS[provider].hintPrefix(apiKey)}…${apiKey.slice(-4)}`;
}
