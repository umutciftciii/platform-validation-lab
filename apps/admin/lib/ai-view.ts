/**
 * DP-292 (ADR-030): pure helpers of the AI Center screens — tabs, provider names, money in micro-USD,
 * capability labels and which actions a key or a model offers to whom. No I/O: the API decides
 * again on every call; these only choose what the admin shows.
 */
import type {
  AiCredentialSummary,
  AiModelSummary,
  AiPermissions,
  AiProviderKey,
} from "@dream/contracts";

export const AI_TABS = ["overview", "providers", "models", "tasks"] as const;
export type AiTab = (typeof AI_TABS)[number];

export function parseAiTab(value: string | string[] | undefined): AiTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (AI_TABS as readonly string[]).includes(v ?? "") ? (v as AiTab) : "overview";
}

/** Product names (never translated). */
export const PROVIDER_NAMES: Readonly<Record<AiProviderKey, string>> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Claude (Anthropic)",
  GEMINI: "Gemini (Google)",
};

/** "1234567" µ$ → "1.234567" (USD, up to six decimals, trailing zeros dropped, at least two). */
export function microsToUsd(micros: string | bigint): string {
  const v = typeof micros === "bigint" ? micros : BigInt(micros);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  let frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** "0.40" / "12" / "0.000001" → micro-USD string; null when not a non-negative amount with ≤ 6 decimals. */
export function usdToMicros(value: string): string | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,6}))?\s*$/.exec(value);
  if (!m) return null;
  const micros =
    BigInt(m[1] as string) * 1_000_000n + BigInt(((m[2] ?? "") + "000000").slice(0, 6));
  return micros.toString();
}

export type Capability = "yes" | "no" | "unknown";
export const capability = (v: boolean | null): Capability =>
  v === null ? "unknown" : v ? "yes" : "no";

export type CredentialAction = "test" | "activate" | "disable" | "revoke";

/** What a key offers to an AI administrator (nothing to anyone else; a revoked key is history). */
export function credentialActions(
  c: Pick<AiCredentialSummary, "status">,
  can: Pick<AiPermissions, "providerManage">,
): CredentialAction[] {
  if (!can.providerManage) return [];
  switch (c.status) {
    case "PENDING_TEST":
      return ["test", "revoke"];
    case "ACTIVE":
      return ["test", "disable", "revoke"];
    case "DISABLED":
      return ["test", "activate", "revoke"];
    default:
      return [];
  }
}

export type ModelAction = "verify" | "enable" | "disable";

/**
 * What a model offers to an AI administrator. Enabling needs a verified, compatible model; a model
 * whose capabilities the provider does not report needs the administrator's explicit confirmation
 * (the dialog asks; the API refuses without it).
 */
export function modelActions(
  m: Pick<AiModelSummary, "status" | "compatible" | "requiresConfirmation">,
  can: Pick<AiPermissions, "modelManage">,
): ModelAction[] {
  if (!can.modelManage) return [];
  switch (m.status) {
    case "ENABLED":
      return ["disable"];
    case "VERIFIED":
      return m.compatible || m.requiresConfirmation ? ["enable", "verify"] : ["verify"];
    case "DISABLED":
      return ["verify", ...(m.compatible ? (["enable"] as const) : [])];
    default:
      return ["verify"];
  }
}

/** The active key of a provider, if any. */
export const activeCredential = (credentials: readonly AiCredentialSummary[]) =>
  credentials.find((c) => c.status === "ACTIVE") ?? null;

/** Models a task or a provider may use: enabled and compatible. */
export const usableModels = <M extends Pick<AiModelSummary, "status" | "compatible">>(
  models: readonly M[],
) => models.filter((m) => m.status === "ENABLED" && m.compatible);
