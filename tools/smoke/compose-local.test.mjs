// DP-277 (ADR-029): the local production-mode overlay (infra/docker/compose.local.yaml).
// Text-based on purpose (no YAML dependency), like compose-dev.test.mjs; `docker compose config`
// in CI checks that the merged file is valid. These tests pin the rules the overlay exists for:
// production builds only, the DEV data volumes only, DEV credentials only, never a build or pull.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../infra/docker/compose.local.yaml",
);
const text = readFileSync(FILE, "utf8");
const code = text
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

/** top-level key -> its own lines. */
function blocks(src) {
  const out = new Map();
  let current = null;
  for (const line of src.split("\n")) {
    const m = /^([a-z][a-z0-9-]*):/.exec(line);
    if (m) {
      current = m[1];
      out.set(current, []);
    } else if (current) out.get(current).push(line);
  }
  return out;
}

/** service name -> its own lines (two-space keys under `services:`). */
function services(lines) {
  const out = new Map();
  let current = null;
  for (const line of lines) {
    const m = /^ {2}([a-z0-9-]+):/.exec(line);
    if (m) {
      current = m[1];
      out.set(current, []);
    } else if (current) out.get(current).push(line);
  }
  return out;
}

const top = blocks(code);
const svc = services(top.get("services") ?? []);
const NODE_SERVICES = ["migrate", "api", "web-bv", "web-corporate", "admin"];

test("every Node service runs the promoted local image, never built or pulled", () => {
  const anchor = top.get("x-local-image");
  assert.ok(anchor, "x-local-image anchor missing");
  const a = anchor.join("\n");
  assert.match(
    a,
    /image: \$\{DP_LOCAL_IMAGE_REPO:-dream-petroleum-platform-local\}:\$\{DP_LOCAL_TAG:-current\}/,
  );
  assert.match(a, /build: !reset null/);
  assert.match(a, /pull_policy: never/);
  for (const name of NODE_SERVICES) {
    const lines = svc.get(name);
    assert.ok(lines, `${name} missing`);
    assert.ok(
      lines.some((l) => /^ {4}<<: \*local-image\s*$/.test(l)),
      `${name} does not use the local image`,
    );
  }
});

test("no development server, watcher, source bind mount or shared node_modules volume", () => {
  assert.doesNotMatch(code, /next", "dev"|next dev/);
  assert.doesNotMatch(code, /--watch/);
  assert.doesNotMatch(code, /\.\.\/\.\.:/, "the repository is bind-mounted");
  assert.doesNotMatch(code, /dev-nm-|dev-next-|dev-dist-|dev-pnpm-store|dev-turbo/);
  assert.doesNotMatch(
    code,
    /^\s+command:/m,
    "commands come from compose.yaml (next start, node dist)",
  );
});

test("only the DEV data volumes; the production-mode volumes are never named", () => {
  assert.deepEqual(
    (top.get("volumes") ?? [])
      .map((l) => /^ {2}([a-z0-9-]+):/.exec(l)?.[1])
      .filter(Boolean)
      .sort(),
    ["dev-media", "postgres-data-dev", "tls-ca-dev", "tls-config-dev"],
  );
  assert.doesNotMatch(code, /(^|[^-])postgres-data:|media-data/m);
  assert.ok(
    svc.get("postgres").some((l) => /- postgres-data-dev:\/var\/lib\/postgresql\/data/.test(l)),
  );
  assert.ok(svc.get("api").some((l) => /- dev-media:\/data\/media/.test(l)));
  assert.ok(
    svc.get("postgres").some((l) => /com\.dream-petroleum\.platform\.db-env: dev/.test(l)),
    "the Postgres label must name the DEV database (ADR-009)",
  );
});

test("every credential and key is a DEV value from .env, never a literal", () => {
  const secretLine = /(PASSWORD|PROXY_KEY|IAM_|DATABASE_URL)[A-Z_]*:/;
  const lines = code.split("\n").filter((l) => secretLine.test(l));
  assert.ok(lines.length >= 15, `expected the DEV credential lines, found ${lines.length}`);
  for (const line of lines) {
    const value = line.replace(/^[^:]*:\s*/, "");
    assert.match(value, /\$\{DEV_/, `not a DEV variable: ${line.trim()}`);
    assert.doesNotMatch(
      value.replace(/\$\{[^}]*\}/g, ""),
      /[A-Za-z0-9]{16,}/,
      `literal: ${line.trim()}`,
    );
  }
  assert.match(svc.get("api").join("\n"), /DB_ENV: dev\b/);
  assert.match(svc.get("api").join("\n"), /DB_EXPECTED_NAME: \$\{DEV_POSTGRES_DB\}/);
});

test("admin-tls keeps the DEV proxy: port 3114, its CA volumes, init and restart (DP-119, DP-182)", () => {
  const t = svc.get("admin-tls");
  assert.ok(t, "admin-tls missing");
  const s = t.join("\n");
  assert.match(s, /"127\.0\.0\.1:3114:443"/);
  assert.match(s, /- tls-ca-dev:\/data/);
  assert.match(s, /init: true/);
  assert.match(s, /restart: unless-stopped/);
  assert.match(s, /pull_policy: never/);
  assert.match(svc.get("api").join("\n"), /https:\/\/admin\.localhost:3114/);
});
