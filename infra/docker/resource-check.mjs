// Resource preflight for the shared Docker Desktop VM. Runs inside a tiny throwaway container
// started by infra/docker/lib.sh, so /proc/meminfo and /proc/pressure/memory are the VM's, not the
// host's.
//
//   stdin: <compose config JSON or {}> "\n@@\n" <docker inspect JSON of this project's running
//          containers> "\n@@\n" <docker stats JSON lines of the same containers>
//   argv:  <job> <jobBytes> <reserveBytes>
//          job = dev | prod     plan for `up` of that mode (replaces this project's containers)
//                heavy:<name>   a one-off job (toolbox, check build) next to what is running now
//                report         print the table only
//
// Decision (DP-116, resource-policy.mjs): the job may start only if the VM's available memory
// covers the job's estimated peak plus a growth allowance for the running containers, and still
// keeps the reserve for other projects plus a safety margin; an OOM-killed container, a container
// close to its limit or memory stalls in the VM block it too. Exit 0 = ok, 3 = memory, 2 = a
// service has no memory limit, 4 = a service's cpus limit exceeds the engine's CPU count.
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { decide, parsePressure } from "./resource-policy.mjs";

const MiB = 1024 * 1024;
const [job = "report", jobBytesArg = "0", reserveArg = String(1024 * MiB)] = process.argv.slice(2);
const jobBytes = Number(jobBytesArg);
const reserve = Number(reserveArg);

const [composeRaw = "{}", inspectRaw = "[]", statsRaw = ""] = readFileSync(0, "utf8").split(
  "\n@@\n",
);
const compose = JSON.parse(composeRaw.trim() || "{}");
const inspect = JSON.parse(inspectRaw.trim() || "[]");

const units = { B: 1, KiB: 1024, MiB, GiB: 1024 * MiB, kB: 1000, MB: 1e6, GB: 1e9 };
const toBytes = (s) => {
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(s.trim());
  return m ? Number(m[1]) * (units[m[2]] ?? 1) : 0;
};
const usage = new Map(
  statsRaw
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l))
    .map((s) => [s.Name, toBytes(s.MemUsage.split("/")[0])]),
);

const meminfo = Object.fromEntries(
  readFileSync("/proc/meminfo", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [k, v] = l.split(":");
      return [k, Number.parseInt(v, 10) * 1024];
    }),
);
const vmTotal = meminfo.MemTotal;
const vmAvailable = meminfo.MemAvailable;
// This container has no CPU limit or cpuset, so it sees every CPU of the engine.
const engineCpus = availableParallelism();

const mib = (b) => `${Math.round(b / MiB)}`.padStart(6) + " MiB";
const heapOf = (env = {}) => /--max-old-space-size=(\d+)/.exec(env.NODE_OPTIONS ?? "")?.[1] ?? "-";

// Planned services of the mode (from the rendered Compose config).
const services = Object.entries(compose.services ?? {}).map(([name, s]) => ({
  name,
  container: s.container_name ?? name,
  limit: Number(s.mem_limit ?? 0),
  swap: Number(s.memswap_limit ?? 0),
  cpus: s.cpus ?? "-",
  heap: heapOf(s.environment),
  oneShot: s.restart === "no",
}));

let status = 0;
if (services.length) {
  console.log(`Budget (${job}):`);
  console.log("  service             memory limit  swap  cpus  node heap  kind");
  for (const s of services) {
    const swap = s.swap && s.swap === s.limit ? "none" : "ALLOWED";
    console.log(
      `  ${s.name.padEnd(18)} ${mib(s.limit)}  ${swap.padEnd(5)} ${String(s.cpus).padStart(4)}  ${String(s.heap).padStart(5)} MiB  ${s.oneShot ? "one-shot (runs before the apps)" : "long-running"}`,
    );
    if (!s.limit) {
      console.log(`  FAIL: service ${s.name} has no mem_limit`);
      status = 2;
    }
    const cpus = Number(s.cpus);
    if (Number.isFinite(cpus) && cpus > engineCpus) {
      console.log(
        `  FAIL: service ${s.name} asks for ${cpus} cpus; the engine has ${engineCpus} (Docker refuses it)`,
      );
      status = status || 4;
    }
  }
}

const longRunning = services.filter((s) => !s.oneShot).reduce((a, s) => a + s.limit, 0);
const oneShot = services.filter((s) => s.oneShot).reduce((a, s) => a + s.limit, 0);
const postgres = services.find((s) => s.name === "postgres")?.limit ?? 0;
const planPeak = Math.max(longRunning, oneShot + postgres);
if (services.length) {
  console.log(
    `  steady state ${mib(longRunning).trim()}; install phase ${mib(oneShot + postgres).trim()}; peak ${mib(planPeak).trim()}`,
  );
}

// Running containers of this project: what they use now and may still grow to.
const running = inspect.map((c) => {
  const name = c.Name.replace(/^\//, "");
  const limit = c.HostConfig?.Memory ?? 0;
  const used = usage.get(name) ?? 0;
  return { name, limit, used, oomKilled: c.State?.OOMKilled === true };
});
if (running.length) {
  console.log("Running containers of this project:");
  for (const c of running) {
    console.log(
      `  ${c.name.padEnd(30)} uses ${mib(c.used)} of ${c.limit ? mib(c.limit) : "  NO LIMIT"}`,
    );
  }
  if (running.some((c) => !c.limit)) {
    console.log(
      "  WARN: containers without a limit were created before the budget; `up` recreates them.",
    );
  }
}

console.log(
  `Docker VM: ${engineCpus} cpus, total ${mib(vmTotal).trim()}, available now ${mib(vmAvailable).trim()}, reserve kept for other projects ${mib(reserve).trim()}`,
);

let pressure = null;
try {
  pressure = parsePressure(readFileSync("/proc/pressure/memory", "utf8"));
} catch {
  // Kernels without PSI: the memory rule still applies.
}
if (pressure?.some) {
  console.log(
    `Memory pressure (PSI) in the VM: some avg10 ${pressure.some.avg10}%, full avg10 ${pressure.full?.avg10 ?? "-"}%`,
  );
}

const report = (label, peak, d) => {
  console.log(
    `${label}: available ${mib(vmAvailable).trim()}; estimated peak need ${mib(d.need).trim()} ` +
      `(job ${mib(peak).trim()} + growth allowance of running containers ${mib(d.growth).trim()}` +
      `${d.need < peak + d.growth ? ", minus what the recreated containers free" : ""}); ` +
      `${mib(d.left).trim()} would stay free, at least ${mib(d.floor).trim()} required ` +
      `(reserve ${mib(reserve).trim()} + safety margin ${mib(d.margin).trim()})`,
  );
  for (const r of d.reasons) console.log(`  BLOCKED: ${r}`);
};

if (job !== "report") {
  const decisions = [];
  if (job === "dev" || job === "prod") {
    // `up` builds the image (jobBytes) next to the running containers, then recreates them: the
    // new plan has no usage yet, so its hard limits (planPeak) are its estimate, and what the
    // old containers use is freed. Their own state does not block `up`, which recreates them.
    decisions.push([
      `Job ${job} image build`,
      jobBytes,
      decide({
        vmAvailable,
        reserve,
        jobBytes,
        running,
        pressure,
        replaced: false,
        checkContainers: false,
      }),
    ]);
    decisions.push([
      `Job ${job} start (plan limits ${mib(planPeak).trim()}, a hard cap)`,
      planPeak,
      decide({
        vmAvailable,
        reserve,
        jobBytes: planPeak,
        running,
        pressure,
        replaced: true,
        hardCap: true,
      }),
    ]);
  } else if (job.startsWith("heavy:")) {
    decisions.push([
      `Job ${job}`,
      jobBytes,
      decide({ vmAvailable, reserve, jobBytes, running, pressure }),
    ]);
  }
  for (const [label, peak, d] of decisions) report(label, peak, d);
  if (decisions.some(([, , d]) => !d.ok)) {
    console.log(
      "FAIL: the job would put the shared Docker VM at risk (reasons above). Free memory first, " +
        "for example stop the dev/prod stack or wait for another heavy job.",
    );
    status = status || 3;
  } else if (status === 0) {
    console.log("OK");
  }
}
process.exit(status);
