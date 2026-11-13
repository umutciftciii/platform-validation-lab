// DP-116: the resource preflight, old rule versus new rule, on measurements taken on the local
// Docker Desktop VM (8 GB, 10 cpus) on 2026-11-12. Run: node --test infra/docker/
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MiB,
  POLICY,
  decide,
  growthOf,
  legacyHeavy,
  parsePressure,
  toMiB,
} from "./resource-policy.mjs";

const RESERVE = 1024 * MiB;
const CHECK_BUILD = 3072 * MiB; // BUILD_BUDGET_MB (infra/docker/lib.sh)
const INTEGRATION = (1536 + 512) * MiB; // runner + Postgres (tools/test/integration-test.sh)
const c = (name, usedMiB, limitMiB, extra = {}) => ({
  name,
  used: usedMiB * MiB,
  limit: limitMiB * MiB,
  ...extra,
});

// 08:58Z: `stack.sh check` refused with "needs 6015 MiB more; -1754 MiB would stay free".
const DEV_0858 = {
  vmAvailable: 4261 * MiB,
  running: [
    c("dream-platform-api", 568, 896),
    c("dream-platform-web-corporate", 193, 640),
    c("dream-platform-admin", 622, 1280),
    c("dream-platform-web-bv", 468, 1280),
    c("dream-platform-dev-packages", 296, 640),
    c("dream-platform-postgres", 29, 384),
  ],
};
// 11:00Z: DEV running after the DP-084 fix (admin with all pages compiled).
const DEV_1100 = {
  vmAvailable: 4441 * MiB,
  running: [
    c("dream-platform-api", 526, 896),
    c("dream-platform-web-corporate", 197, 640),
    c("dream-platform-web-bv", 203, 1280),
    c("dream-platform-admin", 730, 1280),
    c("dream-platform-dev-packages", 295, 640),
    c("dream-platform-postgres", 23, 384),
  ],
};
// DEV down, `stack.sh check` sampled every 0.5 s: MemAvailable 6457 → 3649 MiB at the lowest,
// so the check build itself peaked at 2808 MiB; PSI some avg10 reached 19.76 %.
const MEASURED_CHECK_PEAK = 2808 * MiB;
const BUILD_PSI = parsePressure(
  "some avg10=19.76 avg60=4.10 avg300=1.00 total=1\nfull avg10=18.02 avg60=3.90 avg300=0.90 total=1",
);
const near = (actual, expectedMiB) =>
  assert.ok(Math.abs(toMiB(actual) - expectedMiB) <= 2, `${toMiB(actual)} vs ${expectedMiB}`);

test("old rule reproduces the real refusal of 08:58Z (6015 MiB needed, -1754 left)", () => {
  const old = legacyHeavy({ ...DEV_0858, reserve: RESERVE, jobBytes: CHECK_BUILD });
  near(old.need, 6015);
  near(old.left, -1754);
  assert.equal(old.ok, false);
});

test("new rule needs ~2.4 GiB less for the same moment, and still refuses the check build", () => {
  const old = legacyHeavy({ ...DEV_0858, reserve: RESERVE, jobBytes: CHECK_BUILD });
  const now = decide({ ...DEV_0858, reserve: RESERVE, jobBytes: CHECK_BUILD });
  near(now.growth, 544); // 25 % of usage, capped by each limit; the old rule assumed 2944 MiB
  near(now.need, 3616);
  assert.ok(old.need - now.need > 2300 * MiB);
  // 645 MiB would stay free, below reserve 1024 + margin 307: a borderline case, refused.
  near(now.left, 645);
  near(now.floor, 1331);
  assert.equal(now.ok, false);
  assert.match(now.reasons.join("\n"), /4261 MiB available, 3616 MiB needed/);
});

test("measured check build peak fits its budget", () => {
  assert.ok(MEASURED_CHECK_PEAK <= CHECK_BUILD);
  assert.ok(CHECK_BUILD - MEASURED_CHECK_PEAK < 0.15 * CHECK_BUILD); // the budget is not padded
});

test("check build next to DEV at 11:00Z: refused by both rules, the new one by a narrow margin", () => {
  const old = legacyHeavy({ ...DEV_1100, reserve: RESERVE, jobBytes: CHECK_BUILD });
  const now = decide({ ...DEV_1100, reserve: RESERVE, jobBytes: CHECK_BUILD });
  assert.equal(old.ok, false);
  near(old.left, -1777);
  assert.equal(now.ok, false);
  near(now.left, 876);
  // Even with the measured peak instead of the budget, it stays under the floor.
  const measured = decide({ ...DEV_1100, reserve: RESERVE, jobBytes: MEASURED_CHECK_PEAK });
  assert.equal(measured.ok, false);
});

test("integration tests next to DEV at 11:00Z: refused before, allowed now", () => {
  const old = legacyHeavy({ ...DEV_1100, reserve: RESERVE, jobBytes: INTEGRATION });
  const now = decide({ ...DEV_1100, reserve: RESERVE, jobBytes: INTEGRATION });
  assert.equal(old.ok, false);
  assert.equal(now.ok, true);
  assert.ok(now.left >= now.floor);
  near(now.left, 1900);
});

test("check build with DEV down: allowed by both rules", () => {
  const vm = { vmAvailable: 6457 * MiB, running: [] };
  assert.equal(legacyHeavy({ ...vm, reserve: RESERVE, jobBytes: CHECK_BUILD }).ok, true);
  assert.equal(decide({ ...vm, reserve: RESERVE, jobBytes: CHECK_BUILD }).ok, true);
});

test("`dev up` plan (5120 MiB of limits, a hard cap) with DEV down: allowed without extra margin", () => {
  const d = decide({
    vmAvailable: 6424 * MiB,
    reserve: RESERVE,
    jobBytes: 5120 * MiB,
    hardCap: true,
    replaced: true,
  });
  assert.equal(d.margin, 0);
  assert.equal(d.ok, true);
  near(d.left, 1304);
});

test("borderline: one MiB under the floor is refused, exactly on it is allowed", () => {
  const jobBytes = 2000 * MiB;
  const floor = RESERVE + Math.max(POLICY.minMarginBytes, jobBytes * POLICY.marginShare);
  assert.equal(
    decide({ vmAvailable: jobBytes + floor - MiB, reserve: RESERVE, jobBytes }).ok,
    false,
  );
  assert.equal(decide({ vmAvailable: jobBytes + floor, reserve: RESERVE, jobBytes }).ok, true);
});

test("an OOM-killed container blocks a heavy job even with plenty of memory", () => {
  const d = decide({
    vmAvailable: 7000 * MiB,
    reserve: RESERVE,
    jobBytes: 512 * MiB,
    running: [c("dream-platform-admin", 300, 1280, { oomKilled: true })],
  });
  assert.equal(d.ok, false);
  assert.match(d.reasons[0], /OOM-killed/);
});

test("a container at 90 % of its limit blocks a heavy job", () => {
  const d = decide({
    vmAvailable: 7000 * MiB,
    reserve: RESERVE,
    jobBytes: 512 * MiB,
    running: [c("dream-platform-api", 810, 896)],
  });
  assert.equal(d.ok, false);
  assert.match(d.reasons[0], /810 of its 896 MiB limit/);
});

test("memory stalls in the VM (PSI measured during the check build) block a heavy job", () => {
  const d = decide({
    vmAvailable: 7000 * MiB,
    reserve: RESERVE,
    jobBytes: 512 * MiB,
    pressure: BUILD_PSI,
  });
  assert.equal(d.ok, false);
  assert.match(d.reasons[0], /PSI some avg10 = 19.76%/);
  const calm = parsePressure(
    "some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1",
  );
  assert.equal(
    decide({ vmAvailable: 7000 * MiB, reserve: RESERVE, jobBytes: 512 * MiB, pressure: calm }).ok,
    true,
  );
});

test("`up` recreates the containers: their state does not block, their usage is freed", () => {
  const running = [c("dream-platform-admin", 1250, 1280, { oomKilled: true })];
  const d = decide({
    vmAvailable: 5000 * MiB,
    reserve: RESERVE,
    jobBytes: 5120 * MiB,
    running,
    replaced: true,
    hardCap: true,
  });
  assert.equal(d.growth, 0);
  near(d.need, 5120 - 1250);
  assert.equal(d.ok, true);
});

test("growth allowance: a share of usage, capped by the limit; no limit means the share only", () => {
  assert.equal(growthOf(c("a", 400, 1000)), 100 * MiB);
  assert.equal(growthOf(c("b", 950, 1000)), 50 * MiB);
  assert.equal(growthOf({ name: "c", used: 400 * MiB, limit: 0 }), 100 * MiB);
});

test("observed run: check build allowed next to a fresh DEV stayed well above the floor", () => {
  // 11:2xZ, DEV just started: the check said OK with 1385 MiB to spare; sampled MemAvailable went
  // from 4864 to 2529 MiB at the lowest (PSI some avg10 at most 4.24 %), no restart, no OOM.
  const d = decide({
    vmAvailable: 4838 * MiB,
    reserve: RESERVE,
    jobBytes: CHECK_BUILD,
    running: [
      c("dream-platform-api", 300, 896),
      c("dream-platform-web-corporate", 190, 640),
      c("dream-platform-web-bv", 196, 1280),
      c("dream-platform-admin", 230, 1280),
      c("dream-platform-dev-packages", 297, 640),
      c("dream-platform-postgres", 21, 384),
    ],
  });
  assert.equal(d.ok, true);
  const observedLowest = 2529 * MiB;
  assert.ok(observedLowest >= d.left, "the estimate must not be optimistic");
  assert.ok(observedLowest >= d.floor);
});
