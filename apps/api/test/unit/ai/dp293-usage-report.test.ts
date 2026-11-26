/**
 * DP-293 (ADR-030 D6, D7): the pure part of the AI usage reports — UTC day/month boundaries,
 * micro-USD sums without floats, the estimated / reserved / actual / assumed split, outcome
 * classes, query parsing and the alert rules. The HTTP routes are covered in
 * test/integration/owner.int.test.ts (DP-293 block).
 */
import { describe, expect, it } from "vitest";
import {
  AI_OPERATION_STATUSES,
  AI_OUTCOMES,
  AI_OUTCOME_OF_STATUS,
  AiUsageReportSchema,
} from "@dream/contracts";
import {
  ReportQueryError,
  Sums,
  budgetState,
  bucketOf,
  bucketsOf,
  bySpend,
  groupSums,
  operationWhere,
  parseFilters,
  parseRange,
  parseUsageQuery,
  permille,
  reconciliationDiffers,
  seriesOf,
  startOfUtc,
  statusesOf,
  utcDay,
  type UsageRow,
} from "../../../src/ai/reports/usage-report.js";

const MODEL = "0190f0a0-0000-7000-8000-000000000001";
const SITE = "0190f0a0-0000-7000-8000-0000000000aa";

function op(over: Partial<UsageRow> = {}): UsageRow {
  return {
    status: "SUCCEEDED",
    provider: "OPENAI",
    modelId: MODEL,
    task: "DIAGNOSTIC_PING",
    siteId: null,
    reservedAt: new Date("2026-11-26T12:00:00.000Z"),
    reservedMicros: 1_000n,
    actualMicros: 400n,
    costBasis: "LOCAL_USAGE",
    actInputTokens: 10,
    actCachedReadTokens: 2,
    actCacheWriteTokens: 0,
    actOutputTokens: 5,
    actReasoningTokens: 1,
    ...over,
  };
}

describe("UTC periods and buckets", () => {
  it("cuts days and months at 00:00 UTC, whatever the server's time zone", () => {
    expect(startOfUtc("day", new Date("2026-11-26T23:59:59.999Z")).toISOString()).toBe(
      "2026-11-26T00:00:00.000Z",
    );
    expect(startOfUtc("day", new Date("2026-11-27T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-27T00:00:00.000Z",
    );
    expect(startOfUtc("month", new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(bucketOf("day", new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11-30");
    expect(bucketOf("day", new Date("2026-12-01T00:00:00.000Z"))).toBe("2026-12-01");
    expect(bucketOf("month", new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11");
    expect(bucketOf("month", new Date("2026-12-01T00:00:00.000Z"))).toBe("2026-12");
  });

  it("lists every bucket of a range, across month and year ends", () => {
    expect(bucketsOf("day", utcDay("2026-11-29")!, utcDay("2026-12-02")!)).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
    expect(bucketsOf("month", utcDay("2026-11-15")!, utcDay("2027-02-01")!)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(bucketsOf("day", utcDay("2028-02-28")!, utcDay("2028-03-01")!)).toHaveLength(3);
  });

  it("refuses dates that are not real calendar days", () => {
    expect(utcDay("2026-02-30")).toBeNull();
    expect(utcDay("2026-11-26T00:00Z")).toBeNull();
    expect(utcDay("26-11-2026")).toBeNull();
    expect(utcDay("2028-02-29")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("puts an operation in the day of its reservation; the series has zeros for empty days", () => {
    const q = parseUsageQuery({ from: "2026-11-25", to: "2026-11-27" });
    const series = seriesOf(q, [
      op({ reservedAt: new Date("2026-11-25T23:59:59.999Z") }),
      op({ reservedAt: new Date("2026-11-27T00:00:00.000Z") }),
    ]);
    expect(series.map((s) => [s.bucket, s.totals.operations])).toEqual([
      ["2026-11-25", 1],
      ["2026-11-26", 0],
      ["2026-11-27", 1],
    ]);
    expect(q.end.toISOString()).toBe("2026-11-28T00:00:00.000Z");
  });
});

describe("micro-USD sums", () => {
  it("keeps estimated, reserved, actual and assumed apart", () => {
    const s = new Sums();
    s.add(op()); // finished: actual 400 of an estimate of 1000
    s.add(op({ status: "IN_FLIGHT", actualMicros: null, costBasis: "NONE", reservedMicros: 700n }));
    s.add(op({ status: "RESERVED", actualMicros: null, costBasis: "NONE", reservedMicros: 300n }));
    s.add(
      op({ status: "UNKNOWN", actualMicros: 900n, costBasis: "ASSUMED", reservedMicros: 900n }),
    );
    s.add(op({ status: "CANCELLED", actualMicros: null, costBasis: "NONE", reservedMicros: 50n }));
    const d = s.dto();
    expect(d).toMatchObject({
      operations: 5,
      estimatedMicros: "2950",
      reservedMicros: "1000",
      actualMicros: "400",
      assumedMicros: "900",
      settledEstimateMicros: "1000",
      overruns: 0,
      outcomes: { succeeded: 1, open: 2, unknown: 1, cancelled: 1, failed: 0, discarded: 0 },
    });
  });

  it("adds integers only: exact up to the contract's 15 digits (no float, no rounding)", () => {
    const s = new Sums();
    const half = 499_999_999_999_999n;
    s.add(op({ reservedMicros: half, actualMicros: half }));
    s.add(op({ reservedMicros: half + 1n, actualMicros: half + 1n }));
    expect(s.dto().actualMicros).toBe("999999999999999");
    expect(0.1 + 0.2).not.toBe(0.3); // what a float sum would do to cents
    const odd = new Sums();
    for (let i = 0; i < 10; i++) odd.add(op({ actualMicros: 1n, reservedMicros: 3n }));
    expect(odd.dto()).toMatchObject({ actualMicros: "10", estimatedMicros: "30" });
  });

  it("counts an overrun (actual above the estimate) and a discarded late answer at its cost", () => {
    const s = new Sums();
    s.add(op({ reservedMicros: 100n, actualMicros: 101n }));
    s.add(op({ status: "DISCARDED", reservedMicros: 100n, actualMicros: 80n }));
    expect(s.dto()).toMatchObject({
      overruns: 1,
      actualMicros: "181",
      outcomes: { succeeded: 1, discarded: 1 },
    });
  });

  it("groups by key and orders by spend (actual + assumed)", () => {
    const rows = [
      op({ provider: "OPENAI", actualMicros: 5n }),
      op({ provider: "GEMINI", status: "UNKNOWN", costBasis: "ASSUMED", actualMicros: 50n }),
      op({ provider: "ANTHROPIC", actualMicros: 10n }),
      op({ provider: "OPENAI", actualMicros: 1n }),
    ];
    const groups = groupSums(rows, (r) => r.provider).sort(bySpend);
    expect(groups.map((g) => [g.key, g.sums.dto().operations])).toEqual([
      ["GEMINI", 1],
      ["ANTHROPIC", 1],
      ["OPENAI", 2],
    ]);
  });

  it("maps every status to exactly one outcome class", () => {
    for (const s of AI_OPERATION_STATUSES) expect(AI_OUTCOMES).toContain(AI_OUTCOME_OF_STATUS[s]);
    const all = AI_OUTCOMES.flatMap((o) => statusesOf(o)).sort();
    expect(all).toEqual([...AI_OPERATION_STATUSES].sort());
    expect(statusesOf("cancelled").sort()).toEqual(["CANCELLED", "EXPIRED", "RELEASED"]);
  });

  it("a report built from the sums parses against the contract", () => {
    const q = parseUsageQuery({ from: "2026-11-01", to: "2026-11-30", granularity: "month" });
    const totals = new Sums();
    totals.add(op());
    const report = {
      from: q.fromDay,
      to: q.toDay,
      granularity: q.granularity,
      totals: totals.dto(),
      series: seriesOf(q, [op()]),
      byProvider: [{ provider: "OPENAI", totals: totals.dto() }],
      byModel: [],
      byTask: [],
      bySite: [{ siteId: null, totals: totals.dto() }],
    };
    expect(AiUsageReportSchema.parse(report).series).toHaveLength(1);
  });
});

describe("query parsing", () => {
  const rule = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof ReportQueryError) return `${e.path}:${e.rule}`;
      throw e;
    }
    return "ok";
  };

  it("needs a range of at most 366 days, from before to", () => {
    expect(rule(() => parseUsageQuery({}))).toBe("from:date");
    expect(rule(() => parseUsageQuery({ from: "2026-11-02", to: "2026-11-01" }))).toBe("to:range");
    expect(rule(() => parseUsageQuery({ from: "2026-01-01", to: "2027-01-02" }))).toBe("to:range");
    expect(rule(() => parseUsageQuery({ from: "2026-01-01", to: "2026-12-31" }))).toBe("ok");
    expect(
      rule(() => parseUsageQuery({ from: "2026-01-01", to: "2026-01-01", granularity: "week" })),
    ).toBe("granularity:unknown");
    expect(parseRange({}, 10)).toBeNull();
    expect(rule(() => parseRange({ from: "2026-01-01" }, 10))).toBe("to:date");
  });

  it("validates every filter and maps `platform` to no site", () => {
    expect(parseFilters({ provider: "gemini", task: "seo_meta", siteId: "platform" })).toEqual({
      provider: "GEMINI",
      task: "SEO_META",
      siteId: null,
    });
    expect(rule(() => parseFilters({ provider: "mistral" }))).toBe("provider:unknown");
    expect(rule(() => parseFilters({ modelId: "x" }))).toBe("modelId:uuid");
    expect(rule(() => parseFilters({ siteId: "all" }))).toBe("siteId:uuid");
    expect(rule(() => parseFilters({ outcome: "SUCCEEDED" }))).toBe("outcome:unknown");
    expect(rule(() => parseFilters({ task: "DROP TABLE" }))).toBe("task:unknown");
  });

  it("turns filters into a database condition without free text", () => {
    const where = operationWhere(
      { provider: "OPENAI", siteId: SITE.toUpperCase().toLowerCase(), outcome: "unknown" },
      { from: utcDay("2026-11-01")!, end: utcDay("2026-11-02")! },
    );
    expect(where).toEqual({
      reservedAt: { gte: utcDay("2026-11-01"), lt: utcDay("2026-11-02") },
      provider: "OPENAI",
      siteId: SITE,
      status: { in: ["UNKNOWN"] },
    });
    expect(operationWhere({ siteId: null }, null)).toEqual({ siteId: null });
  });
});

describe("alert rules", () => {
  it("budget: exceeded at the limit (used = committed + assumed); warning includes reserved", () => {
    expect(budgetState(1_000n, 0n, 1_000n, 80)).toBe("exceeded");
    expect(budgetState(999n, 0n, 1_000n, 80)).toBe("warning");
    expect(budgetState(700n, 99n, 1_000n, 80)).toBe("ok");
    expect(budgetState(700n, 100n, 1_000n, 80)).toBe("warning");
    expect(budgetState(0n, 0n, 1_000n, 100)).toBe("ok");
  });

  it("used share in tenths of a percent, rounded down", () => {
    expect(permille(1n, 3n)).toBe(333);
    expect(permille(2n, 3n)).toBe(666);
    expect(permille(5_000_001n, 5_000_000n)).toBe(1000);
    expect(permille(1n, 0n)).toBe(0);
  });

  it("reconciliation: differs at ≥ max($0.01, 5 % of local + assumed)", () => {
    expect(reconciliationDiffers(0n, 0n, 9_999n)).toBe(false);
    expect(reconciliationDiffers(0n, 0n, 10_000n)).toBe(true);
    expect(reconciliationDiffers(1_000_000n, 0n, 1_049_999n)).toBe(false);
    expect(reconciliationDiffers(900_000n, 100_000n, 1_050_000n)).toBe(true);
    expect(reconciliationDiffers(1_000_000n, 0n, 950_000n)).toBe(true);
  });
});
