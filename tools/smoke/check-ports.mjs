// Preflight: fails if any platform port is already taken on the host or by another container.
// Run before `docker compose up`. Read-only: it only lists containers.
import { execFileSync } from "node:child_process";
import net from "node:net";
import { PORTS } from "./ports.mjs";

const OWN_PROJECT = "dream-petroleum-platform";

function hostFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

function dockerPublished() {
  try {
    const out = execFileSync(
      "docker",
      ["ps", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Ports}}'],
      { encoding: "utf8" },
    );
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, project, ports] = line.split("\t");
        return { name, project, ports: ports ?? "" };
      });
  } catch {
    return null;
  }
}

const containers = dockerPublished();
let conflicts = 0;
for (const [service, port] of Object.entries(PORTS)) {
  const owner = containers?.find((c) => new RegExp(`:${port}->`).test(c.ports));
  const ours = owner?.project === OWN_PROJECT;
  const free = await hostFree(port);
  let state = "free";
  if (owner && !ours) state = `TAKEN by container ${owner.name} (${owner.project || "no project"})`;
  else if (owner && ours) state = `in use by this platform (${owner.name})`;
  else if (!free) state = "TAKEN by a host process";
  if (state.startsWith("TAKEN")) conflicts += 1;
  console.log(`${service.padEnd(14)} ${String(port).padEnd(5)} ${state}`);
}
if (containers === null) console.log("warning: docker ps failed; only host sockets were checked");
if (conflicts) {
  console.error(`\n${conflicts} port conflict(s). Do not start the stack.`);
  process.exit(1);
}
console.log("\nNo conflicts.");
