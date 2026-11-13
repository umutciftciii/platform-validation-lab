// Memory policy of the resource preflight (DP-116). Pure functions, no I/O: resource-check.mjs
// feeds them the Docker VM's /proc/meminfo and /proc/pressure/memory and this project's
// containers; resource-policy.test.mjs runs them on recorded measurements.
//
// Before DP-116 a heavy job needed `job budget + (limit - used) of EVERY running container`, as if
// all containers reached their hard limits at the same moment, and 1024 MiB had to stay free.
// With the DEV stack up (5120 MiB of limits) the check build could never start, even with 4.2 GiB
// of the VM free. The new rule counts what really happens:
//   - MemAvailable already excludes what the containers use now;
//   - the job's own estimated peak (its hard limit, or its measured build peak);
//   - a growth allowance for running containers: a share of what each uses now, never more
//     than its own limit allows;
//   - the reserve for other projects plus a safety margin, so a borderline case is refused.
// It also refuses outright when a container of this project was OOM-killed, runs close to its
// limit, or the VM already stalls on memory (PSI). There is no override.

export const MiB = 1024 * 1024;

export const POLICY = Object.freeze({
  // Running containers may still grow by this share of their current usage (capped by their limit).
  growthShare: 0.25,
  // Safety margin on top of the reserve: this share of the job's peak, at least minMarginBytes.
  marginShare: 0.1,
  minMarginBytes: 256 * MiB,
  // A container at or above this share of its limit is about to be OOM-killed by its cgroup.
  nearLimitShare: 0.9,
  // /proc/pressure/memory: share of the last 10 s in which some / all tasks stalled on memory.
  pressureSomeAvg10: 10,
  pressureFullAvg10: 5,
});

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const toMiB = (bytes) => Math.round(bytes / MiB);

/** Parses /proc/pressure/memory ("some avg10=0.12 avg60=… total=…" / "full …"). Null if absent. */
export function parsePressure(text) {
  if (!text) return null;
  const read = (kind) => {
    const m = new RegExp(`^${kind} avg10=([\\d.]+) avg60=([\\d.]+)`, "m").exec(text);
    return m ? { avg10: Number(m[1]), avg60: Number(m[2]) } : null;
  };
  const some = read("some");
  const full = read("full");
  return some || full ? { some, full } : null;
}

/** Growth allowance of one running container: a share of its usage, capped by its limit. */
export function growthOf(container, policy = POLICY) {
  const share = container.used * policy.growthShare;
  if (!container.limit) return share;
  return Math.max(0, Math.min(container.limit - container.used, share));
}

/** Pre-DP-116 rule, kept to compare with the new one (resource-policy.test.mjs). */
export function legacyHeavy({ vmAvailable, reserve, jobBytes, running }) {
  const headroom = sum(running.map((c) => (c.limit ? Math.max(0, c.limit - c.used) : 0)));
  const need = jobBytes + headroom;
  const left = vmAvailable - need;
  return { ok: left >= reserve, need, left };
}

/**
 * Decision for a job next to the containers that are running now.
 *
 *   vmAvailable  MemAvailable of the Docker VM (bytes)
 *   reserve      bytes kept free for other projects
 *   jobBytes     estimated peak of the job itself
 *   running      [{ name, used, limit, oomKilled }] of this project (limit 0 = none)
 *   pressure     parsePressure() result or null
 *   replaced     true for `up`: the running containers are recreated, so their usage is freed,
 *                they get no growth allowance, and their own state (OOM-killed, near the limit)
 *                does not block: recreating them is the remedy
 *   checkContainers  whether an OOM-killed container or one near its limit blocks the job
 *                (default: unless replaced; `up` also skips it for its image build)
 *   hardCap      jobBytes is a sum of hard memory limits (an `up` plan): no safety margin on top
 *
 * Returns { ok, need, growth, margin, floor, left, reasons }: the job may start only if
 * `left = vmAvailable - need` stays at or above `floor = reserve + margin` and nothing else
 * blocks it.
 */
export function decide(
  {
    vmAvailable,
    reserve,
    jobBytes,
    running = [],
    pressure = null,
    replaced = false,
    checkContainers = !replaced,
    hardCap = false,
  },
  policy = POLICY,
) {
  const reasons = [];
  for (const c of checkContainers ? running : []) {
    if (c.oomKilled) reasons.push(`${c.name} was OOM-killed (its last run hit the memory limit)`);
    else if (c.limit && c.used >= c.limit * policy.nearLimitShare) {
      reasons.push(
        `${c.name} uses ${toMiB(c.used)} of its ${toMiB(c.limit)} MiB limit (>= ${Math.round(policy.nearLimitShare * 100)}%)`,
      );
    }
  }
  if (pressure?.some && pressure.some.avg10 >= policy.pressureSomeAvg10) {
    reasons.push(`the Docker VM stalls on memory (PSI some avg10 = ${pressure.some.avg10}%)`);
  } else if (pressure?.full && pressure.full.avg10 >= policy.pressureFullAvg10) {
    reasons.push(`the Docker VM stalls on memory (PSI full avg10 = ${pressure.full.avg10}%)`);
  }

  const growth = replaced ? 0 : sum(running.map((c) => growthOf(c, policy)));
  const freed = replaced ? sum(running.map((c) => c.used)) : 0;
  const need = jobBytes + growth - freed;
  // An estimate that is a hard cap (the sum of cgroup limits of a plan) cannot be exceeded, so it
  // needs no margin on top; a measured or budgeted peak gets one.
  const margin = hardCap ? 0 : Math.max(policy.minMarginBytes, jobBytes * policy.marginShare);
  const floor = reserve + margin;
  const left = vmAvailable - need;
  if (left < floor) {
    reasons.push(
      `not enough free memory: ${toMiB(vmAvailable)} MiB available, ${toMiB(need)} MiB needed, ` +
        `${toMiB(left)} MiB would stay free but ${toMiB(floor)} MiB must ` +
        `(reserve ${toMiB(reserve)} + safety margin ${toMiB(margin)})`,
    );
  }
  return { ok: reasons.length === 0, need, growth, margin, floor, left, reasons };
}
