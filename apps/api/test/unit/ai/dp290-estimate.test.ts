/**
 * DP-290 (ADR-030 D6): conservative estimates and the cost formulas (the database functions decide;
 * test/integration/owner.int.test.ts checks parity with ai_upper_cost_micros / ai_actual_cost_micros).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BILLING_PROFILES,
  FALLBACK_PROFILE,
  actualCostMicros,
  estimateInputTokens,
  estimateOutputTokens,
  profileFor,
  upperCostMicros,
  type Price,
} from "../../../src/ai/engine/estimate.js";
import { sweepIntervalSeconds } from "../../../src/ai/ledger.service.js";

const PRICE: Price = {
  inputMicrosPerMTok: 400_000n, // $0.40 / 1M
  cachedReadMicrosPerMTok: 100_000n,
  cacheWriteMicrosPerMTok: null,
  outputMicrosPerMTok: 1_600_000n, // $1.60 / 1M
  longContextThreshold: null,
  longInputMicrosPerMTok: null,
  longOutputMicrosPerMTok: null,
  perRequestFeeMicros: 0n,
};

/** A byte-level tokenizer's worst case: one token per byte is the most it can produce. */
const worstCaseTokens = (s: string) => Buffer.byteLength(s, "utf8");

describe("DP-290: token upper bounds", () => {
  it("never estimates fewer input tokens than bytes (system, input, schema) plus the provider's framing", () => {
    const alphabet = ["a", "ğ", "ı", "ü", "€", "漢", "🙂", " ", "\n", "{", '"'];
    for (let i = 0; i < 200; i++) {
      const pick = () =>
        Array.from(
          { length: randomBytes(1)[0]! },
          () => alphabet[randomBytes(1)[0]! % alphabet.length],
        ).join("");
      const system = pick();
      const input = pick();
      const schema =
        i % 2 ? { type: "object", properties: { text: { type: "string" } } } : undefined;
      for (const [key, profile] of Object.entries(BILLING_PROFILES)) {
        const est = estimateInputTokens({ system, input, responseSchema: schema }, profile);
        const floor =
          worstCaseTokens(system) +
          worstCaseTokens(input) +
          (schema ? worstCaseTokens(JSON.stringify(schema)) : 0);
        expect(est, key).toBeGreaterThanOrEqual(floor + profile.perRequestTokens);
        if (schema) expect(est, key).toBeGreaterThanOrEqual(floor + profile.structuredOutputTokens);
      }
    }
  });

  it("adds the thinking budget only where it is outside the output cap (Gemini)", () => {
    const task = { maxOutputTokens: 1000, thinkingBudget: 2048 };
    expect(estimateOutputTokens(task, profileFor("openai.responses"))).toBe(1000);
    expect(estimateOutputTokens(task, profileFor("anthropic.messages"))).toBe(1000);
    expect(estimateOutputTokens(task, profileFor("gemini.generate"))).toBe(3048);
    // Unknown profiles (the fake provider included) get the most conservative values.
    expect(profileFor("openai.fake")).toBe(FALLBACK_PROFILE);
    expect(estimateOutputTokens(task, FALLBACK_PROFILE)).toBe(3048);
  });
});

describe("DP-290: cost formulas", () => {
  it("reserves every input token at the highest input-side price, output at the output price, plus margin, rounded up", () => {
    // 10 000 in × 0.40 + 2 000 out × 1.60 per 1M = 4 000 + 3 200 = 7 200 µ$; +10 % = 7 920.
    expect(upperCostMicros(PRICE, 10_000, 2_000, 0)).toBe(7_200n);
    expect(upperCostMicros(PRICE, 10_000, 2_000, 10)).toBe(7_920n);
    // Rounded up, never down.
    expect(upperCostMicros(PRICE, 1, 0, 0)).toBe(1n);
    expect(upperCostMicros(PRICE, 0, 0, 0)).toBe(0n);
    // A cache-write price above the input price is the input-side price of the bound.
    expect(upperCostMicros({ ...PRICE, cacheWriteMicrosPerMTok: 500_000n }, 10_000, 0, 0)).toBe(
      5_000n,
    );
    // Long-context tier chosen from the upper bound.
    const tiered = {
      ...PRICE,
      longContextThreshold: 200_000,
      longInputMicrosPerMTok: 800_000n,
      longOutputMicrosPerMTok: 3_200_000n,
    };
    expect(upperCostMicros(tiered, 200_000, 0, 0)).toBe(80_000n);
    expect(upperCostMicros(tiered, 200_001, 0, 0)).toBe(160_001n);
    expect(upperCostMicros({ ...PRICE, perRequestFeeMicros: 100n }, 0, 0, 50)).toBe(150n);
  });

  it("costs reported usage with cached reads cheaper, cache writes at their price, and stays within the bound", () => {
    expect(
      actualCostMicros(PRICE, {
        inputTokens: 5_000,
        cachedReadTokens: 5_000,
        cacheWriteTokens: 0,
        outputTokens: 1_000,
      }),
    ).toBe(2_000n + 500n + 1_600n);
    expect(
      actualCostMicros(
        { ...PRICE, cacheWriteMicrosPerMTok: 500_000n },
        {
          inputTokens: 0,
          cachedReadTokens: 0,
          cacheWriteTokens: 10_000,
          outputTokens: 0,
        },
      ),
    ).toBe(5_000n);
    // Any usage within the token bounds costs at most the reservation (no margin needed).
    for (let i = 0; i < 100; i++) {
      const inBound = 1 + (randomBytes(2).readUInt16BE() % 20_000);
      const outBound = 1 + (randomBytes(2).readUInt16BE() % 4_000);
      const cached = randomBytes(2).readUInt16BE() % (inBound + 1);
      const usage = {
        inputTokens: inBound - cached,
        cachedReadTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: outBound,
      };
      expect(actualCostMicros(PRICE, usage)).toBeLessThanOrEqual(
        upperCostMicros(PRICE, inBound, outBound, 0),
      );
    }
  });
});

describe("DP-290: the sweeper interval", () => {
  it("defaults to 60 s, 0 turns it off, nonsense falls back", () => {
    expect(sweepIntervalSeconds({})).toBe(60);
    expect(sweepIntervalSeconds({ AI_SWEEP_INTERVAL_SECONDS: "0" })).toBe(0);
    expect(sweepIntervalSeconds({ AI_SWEEP_INTERVAL_SECONDS: "15" })).toBe(15);
    expect(sweepIntervalSeconds({ AI_SWEEP_INTERVAL_SECONDS: "-3" })).toBe(60);
    expect(sweepIntervalSeconds({ AI_SWEEP_INTERVAL_SECONDS: "abc" })).toBe(60);
  });
});
