/**
 * DP-288 (ADR-030 D4, D5; owner decisions 7, 9): the AI environment. Read once at start-up by the
 * AI module; errors name the variable, never a value. The global AI switch is NOT here (it is the
 * owner's, PlatformModuleState); this is the operator's environment layer below it.
 *
 * | Variable                       | Meaning                                                      |
 * | ------------------------------ | ------------------------------------------------------------ |
 * | DP_AI_TRANSPORT                | off (default) / fake / live: where provider calls go          |
 * | DP_AI_ENC_KEYS                 | keyring of the provider API keys (secret-box format);        |
 * |                                | required unless off; distinct from every IAM key             |
 * | DP_AI_ALLOW_LIVE_LOCAL         | "true" allows `live` in the local deployment (owner, K-2)    |
 * | DP_AI_LOCAL_CAP_DAILY_USD      | local ceiling per UTC day; may only LOWER the code ceiling   |
 * | DP_AI_LOCAL_CAP_MONTHLY_USD    | local ceiling per UTC month; may only LOWER the code ceiling |
 *
 * - `off`: no provider call can ever be made; nothing else is required (the API starts with no AI
 *   variable at all).
 * - `fake`: the deterministic fake provider (CI, fixtures); needs the keyring (keys are still
 *   stored encrypted).
 * - `live`: real providers. In the local deployment only with DP_AI_ALLOW_LIVE_LOCAL=true, and
 *   every budget there is capped at USD 1/day and USD 5/month (code constants; the environment can
 *   only lower them). Outside the local deployment `live` is refused until the DPO / data
 *   processing approval is recorded (owner decision 14; DP-294).
 */
import { parseKeyring, type Keyring } from "../../iam/auth/secret-box.js";
import type { DeployEnv } from "../../iam/http/api-config.js";

export type AiTransport = "off" | "fake" | "live";

/** Micro-USD: 1 USD = 1 000 000. */
export const MICROS_PER_USD = 1_000_000n;
/** Owner decision 9: the local ceiling, never raised by the environment. */
export const LOCAL_CAP_DAILY_MICROS = 1n * MICROS_PER_USD;
export const LOCAL_CAP_MONTHLY_MICROS = 5n * MICROS_PER_USD;

export interface AiConfig {
  transport: AiTransport;
  /** Null when the transport is off. */
  keyring: Keyring | null;
  /** The local ceilings (micro-USD) when live calls are allowed locally; null otherwise. */
  localCap: { dailyMicros: bigint; monthlyMicros: bigint } | null;
}

export class AiConfigError extends Error {
  override name = "AiConfigError";
}

/** "1", "0.50", "0.25" → micro-USD; at most six decimals; never negative. */
export function parseUsd(value: string, variable: string): bigint {
  const m = /^\s*(\d{1,6})(?:\.(\d{1,6}))?\s*$/.exec(value);
  if (!m) throw new AiConfigError(`${variable} must be a USD amount like 0.50`);
  const whole = BigInt(m[1] as string);
  const frac = BigInt(((m[2] ?? "") + "000000").slice(0, 6));
  return whole * MICROS_PER_USD + frac;
}

function cap(env: NodeJS.ProcessEnv, variable: string, ceiling: bigint): bigint {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") return ceiling;
  const value = parseUsd(raw, variable);
  if (value > ceiling) {
    throw new AiConfigError(`${variable} may only lower the code ceiling, not raise it`);
  }
  if (value === 0n)
    throw new AiConfigError(`${variable} must be above zero (use DP_AI_TRANSPORT=off)`);
  return value;
}

function transportOf(env: NodeJS.ProcessEnv): AiTransport {
  const raw = (env["DP_AI_TRANSPORT"] ?? "off").trim() || "off";
  if (raw !== "off" && raw !== "fake" && raw !== "live") {
    throw new AiConfigError("DP_AI_TRANSPORT must be off, fake or live");
  }
  return raw;
}

/** The raw 32-byte keys of the IAM keyring and HMAC key, to keep the AI keyring apart from them. */
function iamKeys(env: NodeJS.ProcessEnv): Buffer[] {
  const out: Buffer[] = [];
  try {
    out.push(...parseKeyring(env["IAM_MFA_ENC_KEYS"]).keys.values());
  } catch {
    // The IAM module reports its own variables.
  }
  const hmac = env["IAM_HMAC_KEY"]?.trim();
  if (hmac && /^[A-Za-z0-9_-]+$/.test(hmac)) out.push(Buffer.from(hmac, "base64url"));
  return out;
}

export function loadAiConfig(env: NodeJS.ProcessEnv, deployEnv: DeployEnv): AiConfig {
  const transport = transportOf(env);
  if (transport === "off") return { transport, keyring: null, localCap: null };
  let keyring: Keyring;
  try {
    keyring = parseKeyring(env["DP_AI_ENC_KEYS"], "DP_AI_ENC_KEYS");
  } catch (error) {
    throw new AiConfigError((error as Error).message);
  }
  const iam = iamKeys(env);
  for (const key of keyring.keys.values()) {
    if (iam.some((k) => k.equals(key))) {
      throw new AiConfigError("DP_AI_ENC_KEYS must differ from every IAM key");
    }
  }
  if (transport === "fake") return { transport, keyring, localCap: null };
  if (deployEnv !== "local") {
    throw new AiConfigError(
      "DP_AI_TRANSPORT=live is refused outside the local deployment until the DPO approval is recorded (DP-294)",
    );
  }
  if ((env["DP_AI_ALLOW_LIVE_LOCAL"] ?? "").trim() !== "true") {
    throw new AiConfigError(
      "DP_AI_TRANSPORT=live in the local deployment needs DP_AI_ALLOW_LIVE_LOCAL=true",
    );
  }
  const dailyMicros = cap(env, "DP_AI_LOCAL_CAP_DAILY_USD", LOCAL_CAP_DAILY_MICROS);
  const monthlyMicros = cap(env, "DP_AI_LOCAL_CAP_MONTHLY_USD", LOCAL_CAP_MONTHLY_MICROS);
  if (dailyMicros > monthlyMicros) {
    throw new AiConfigError(
      "DP_AI_LOCAL_CAP_DAILY_USD must not exceed DP_AI_LOCAL_CAP_MONTHLY_USD",
    );
  }
  return { transport, keyring, localCap: { dailyMicros, monthlyMicros } };
}

/** The effective limit of a budget: in a capped local deployment never above the ceiling. */
export function effectiveLimitMicros(
  config: AiConfig,
  period: "DAILY" | "MONTHLY",
  limitMicros: bigint,
): bigint {
  if (!config.localCap) return limitMicros;
  const ceiling = period === "DAILY" ? config.localCap.dailyMicros : config.localCap.monthlyMicros;
  return limitMicros < ceiling ? limitMicros : ceiling;
}
