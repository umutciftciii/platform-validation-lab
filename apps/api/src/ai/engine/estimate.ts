/**
 * DP-290 (ADR-030 D6): conservative token and cost estimates, before a provider call.
 *
 * Input upper bound: every token covers at least one UTF-8 byte (byte-level BPE of OpenAI and
 * Claude, byte-fallback SentencePiece of Gemini), so the byte count of the system message, the
 * input and the output schema bounds their tokens; the provider's own additions (message framing,
 * structured-output instructions) are added from the billing profile. Output upper bound: the
 * provider's hard output cap, plus Gemini's explicit thinking budget. No tokenizer, no guess
 * below the truth; profile constants are checked against measured usage in DP-294.
 *
 * The cost formulas mirror the database functions ai_upper_cost_micros / ai_actual_cost_micros
 * (migration dp_290), which decide; a parity test keeps them equal. Money is micro-USD; prices are
 * micro-USD per 1 000 000 tokens.
 */
export interface BillingProfile {
  /** Tokens a provider adds per request (system framing). */
  perRequestTokens: number;
  /** Tokens a provider adds per message. */
  perMessageTokens: number;
  /** Tokens a provider adds when a response schema / tool definition is sent. */
  structuredOutputTokens: number;
  /** The thinking budget counts in addition to the output cap (Gemini). */
  thinkingOutsideOutputCap: boolean;
}

export const BILLING_PROFILES: Readonly<Record<string, BillingProfile>> = {
  "openai.responses": {
    perRequestTokens: 32,
    perMessageTokens: 8,
    structuredOutputTokens: 128,
    thinkingOutsideOutputCap: false,
  },
  "anthropic.messages": {
    perRequestTokens: 64,
    perMessageTokens: 8,
    structuredOutputTokens: 512,
    thinkingOutsideOutputCap: false,
  },
  "gemini.generate": {
    perRequestTokens: 32,
    perMessageTokens: 8,
    structuredOutputTokens: 128,
    thinkingOutsideOutputCap: true,
  },
};
/** The fake provider and any unknown profile: the most conservative values. */
export const FALLBACK_PROFILE: BillingProfile = {
  perRequestTokens: 64,
  perMessageTokens: 8,
  structuredOutputTokens: 512,
  thinkingOutsideOutputCap: true,
};

export function profileFor(key: string): BillingProfile {
  return BILLING_PROFILES[key] ?? FALLBACK_PROFILE;
}

export interface EstimateInput {
  system: string;
  /** The user-side input (already rendered; never stored). */
  input: string;
  /** The JSON schema of a structured answer, if any. */
  responseSchema?: unknown;
  messages?: number;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

export function estimateInputTokens(e: EstimateInput, profile: BillingProfile): number {
  const schema = e.responseSchema === undefined ? "" : JSON.stringify(e.responseSchema);
  return (
    bytes(e.system) +
    bytes(e.input) +
    bytes(schema) +
    profile.perRequestTokens +
    profile.perMessageTokens * Math.max(1, e.messages ?? 2) +
    (schema ? profile.structuredOutputTokens : 0)
  );
}

export function estimateOutputTokens(
  task: { maxOutputTokens: number; thinkingBudget: number },
  profile: BillingProfile,
): number {
  return task.maxOutputTokens + (profile.thinkingOutsideOutputCap ? task.thinkingBudget : 0);
}

export interface Price {
  inputMicrosPerMTok: bigint;
  cachedReadMicrosPerMTok: bigint;
  cacheWriteMicrosPerMTok: bigint | null;
  outputMicrosPerMTok: bigint;
  longContextThreshold: number | null;
  longInputMicrosPerMTok: bigint | null;
  longOutputMicrosPerMTok: bigint | null;
  perRequestFeeMicros: bigint;
}

const M = 1_000_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const max = (...v: bigint[]) => v.reduce((a, b) => (b > a ? b : a));

/** ai_upper_cost_micros: the reservation amount for token upper bounds. */
export function upperCostMicros(
  p: Price,
  inputTokens: number,
  outputTokens: number,
  marginPct: number,
): bigint {
  const long = p.longContextThreshold !== null && inputTokens > p.longContextThreshold;
  const inPrice = max(
    long ? (p.longInputMicrosPerMTok as bigint) : p.inputMicrosPerMTok,
    p.cachedReadMicrosPerMTok,
    p.cacheWriteMicrosPerMTok ?? 0n,
  );
  const outPrice = long ? (p.longOutputMicrosPerMTok as bigint) : p.outputMicrosPerMTok;
  const base =
    ceilDiv(BigInt(inputTokens) * inPrice + BigInt(outputTokens) * outPrice, M) +
    p.perRequestFeeMicros;
  return ceilDiv(base * BigInt(100 + marginPct), 100n);
}

export interface Usage {
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  /** Output including reasoning/thinking tokens. */
  outputTokens: number;
}

/** ai_actual_cost_micros: the cost of reported usage. */
export function actualCostMicros(p: Price, u: Usage): bigint {
  const prompt = u.inputTokens + u.cachedReadTokens + u.cacheWriteTokens;
  const long = p.longContextThreshold !== null && prompt > p.longContextThreshold;
  const inPrice = long ? (p.longInputMicrosPerMTok as bigint) : p.inputMicrosPerMTok;
  const outPrice = long ? (p.longOutputMicrosPerMTok as bigint) : p.outputMicrosPerMTok;
  const sum =
    BigInt(u.inputTokens) * inPrice +
    BigInt(u.cachedReadTokens) * p.cachedReadMicrosPerMTok +
    BigInt(u.cacheWriteTokens) * (p.cacheWriteMicrosPerMTok ?? inPrice) +
    BigInt(u.outputTokens) * outPrice;
  return ceilDiv(sum, M) + p.perRequestFeeMicros;
}
