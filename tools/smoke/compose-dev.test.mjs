// DP-182 (ML-2 PR): the restart policies of the dev overlay (infra/docker/compose.dev.yaml).
// After the Docker VM restarted on 2026-11-20 the admin TLS proxy stayed exited (255): it was the
// only long-running dev service without a restart policy. It now restarts unless an operator
// stopped it; no other service's policy changes. Text-based on purpose (no YAML dependency):
// `docker compose config` in CI checks the file itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../infra/docker/compose.dev.yaml",
);

/** service name -> its own lines (two-space keys under `services:`). */
function services(text) {
  const out = new Map();
  let inServices = false;
  let current = null;
  for (const line of text.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/.test(line)) inServices = false;
    if (!inServices) continue;
    const m = /^ {2}([a-z0-9-]+):/.exec(line);
    if (m) {
      current = m[1];
      out.set(current, []);
    } else if (current) out.get(current).push(line);
  }
  return out;
}

const restartOf = (lines) => {
  const line = lines.find((l) => /^ {4}restart:/.test(l));
  return line
    ? line
        .replace(/^ {4}restart:\s*/, "")
        .replace(/"/g, "")
        .trim()
    : null;
};

const svc = services(readFileSync(FILE, "utf8"));

test("admin-tls restarts unless stopped and keeps its init process (DP-182)", () => {
  const lines = svc.get("admin-tls");
  assert.ok(lines, "admin-tls service missing");
  assert.equal(restartOf(lines), "unless-stopped");
  assert.ok(
    lines.some((l) => /^ {4}init: true\s*$/.test(l)),
    "init: true missing",
  );
});

test("no other restart policy of the dev overlay changes", () => {
  const policies = Object.fromEntries(
    [...svc].filter(([name]) => name !== "admin-tls").map(([name, l]) => [name, restartOf(l)]),
  );
  assert.deepEqual(policies, {
    "dev-install": "no",
    "dev-packages": "unless-stopped",
    postgres: null,
    migrate: null,
    api: null,
    "web-bv": null,
    "web-corporate": null,
    admin: null,
  });
});
