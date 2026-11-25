// DP-283: `stack.sh dev reset --yes` must never lose data. Runs the real dev_reset with a fake
// `docker` on PATH (no Docker needed); the isolated Docker fixture of DP-283 exercises the same
// code against real volumes. Pinned rules:
//  - refused, changing nothing, while any container of another mode exists (local or prod,
//    running or stopped): the reset never stops or removes another mode's stack;
//  - only the explicit allow-list of cache volumes is removed, never dev-media, the DEV/prod
//    databases, prod media or the TLS CA, and never a volume of another project;
//  - every volume is validated before the first removal; any surprise stops with nothing removed.
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STACK = path.join(REPO, "infra/docker/stack.sh");
const P = "dream-petroleum-platform";

const FAKE_DOCKER = `#!/usr/bin/env bash
# ps-all: "<name>|<config files>" lines; vol/<name>: "<project>|<key>"; ps-volume-<name>: users.
args="$*"
case "$1" in
  ps)
    if [[ "$args" == *"volume="* ]]; then
      v="\${args##*volume=}"; v="\${v%% *}"; cat "$FAKE/ps-volume-$v" 2>/dev/null; exit 0
    fi
    cat "$FAKE/ps-all" 2>/dev/null; exit 0 ;;
  compose) echo "$args" >> "$FAKE/compose-log"; [[ ! -f "$FAKE/compose-fails" ]] ;;
  volume)
    case "$2" in
      inspect) name="\${@: -1}"; [[ -f "$FAKE/vol/$name" ]] || exit 1
        [[ "$args" == *"-f"* ]] && cat "$FAKE/vol/$name"; exit 0 ;;
      rm) echo "$3" >> "$FAKE/rm-log"; rm -f "$FAKE/vol/$3"; exit 0 ;;
    esac ;;
  *) exit 0 ;;
esac
`;

const ALL_DEV_KEYS = (() => {
  const text = readFileSync(path.join(REPO, "infra/docker/compose.dev.yaml"), "utf8");
  const top = text.slice(text.indexOf("\nvolumes:\n"));
  return [...top.matchAll(/^ {2}([a-z0-9-]+):/gm)].map((m) => m[1]);
})();
const PROTECTED = ["postgres-data-dev", "dev-media", "tls-ca-dev", "tls-config-dev"];

function setup({ psAll = "", extraVolumes = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-dev-reset-"));
  mkdirSync(path.join(dir, "bin"));
  mkdirSync(path.join(dir, "vol"));
  writeFileSync(path.join(dir, "bin/docker"), FAKE_DOCKER);
  chmodSync(path.join(dir, "bin/docker"), 0o755);
  writeFileSync(path.join(dir, "ps-all"), psAll);
  // Every volume of the dev overlay plus the prod data volumes exist, with correct labels.
  for (const key of [...ALL_DEV_KEYS, "postgres-data", "media-data"])
    writeFileSync(path.join(dir, "vol", `${P}_${key}`), `${P}|${key}\n`);
  for (const [name, content] of Object.entries(extraVolumes))
    writeFileSync(path.join(dir, "vol", name), content);
  return dir;
}

function reset(dir, args = "--yes") {
  const res = spawnSync("bash", ["-c", `set -euo pipefail; source "${STACK}"; dev_reset ${args}`], {
    env: {
      ...process.env,
      PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
      FAKE: dir,
      DREAM_STACK_SOURCE_ONLY: "1",
      DREAM_ENV_FILE: path.join(REPO, ".env.example"),
    },
    encoding: "utf8",
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}
const lines = (dir, f) =>
  existsSync(path.join(dir, f))
    ? readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean)
    : [];
const left = (dir) => readdirSync(path.join(dir, "vol")).sort();

const DEV = "/r/infra/docker/compose.yaml,/r/infra/docker/compose.dev.yaml";
const LOCAL = "/r/infra/docker/compose.yaml,/r/infra/docker/compose.local.yaml";
const PROD = "/r/infra/docker/compose.yaml";

test("the reset allow-list is exactly the dev overlay's volumes minus the protected data", () => {
  const res = spawnSync(
    "bash",
    [
      "-c",
      `source "${STACK}"; echo "\${DEV_CACHE_VOLUME_KEYS[*]}"; echo "\${PROTECTED_VOLUME_KEYS[*]}"`,
    ],
    {
      env: { ...process.env, DREAM_STACK_SOURCE_ONLY: "1" },
      encoding: "utf8",
    },
  );
  const [cache, protectedKeys] = res.stdout.trim().split("\n");
  const expected = ALL_DEV_KEYS.filter((k) => !PROTECTED.includes(k)).sort();
  assert.deepEqual(cache.split(" ").sort(), expected);
  for (const k of [...PROTECTED, "postgres-data", "media-data"])
    assert.ok(protectedKeys.split(" ").includes(k), `${k} not protected`);
  assert.equal(expected.length, 26);
});

test("refused, nothing stopped or removed, while the local mode runs", () => {
  const dir = setup({ psAll: `dream-platform-api|${LOCAL}\ndream-platform-postgres|${LOCAL}\n` });
  try {
    const r = reset(dir);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /containers of another mode exist: dream-platform-api\(local\)/);
    assert.deepEqual(lines(dir, "compose-log"), [], "no compose down");
    assert.deepEqual(lines(dir, "rm-log"), [], "no volume removed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refused while stopped local containers or prod containers exist", () => {
  for (const files of [LOCAL, PROD]) {
    // `docker ps -a` lists stopped containers too; mode comes from the Compose files.
    const dir = setup({ psAll: `dream-platform-migrate|${files}\ndream-platform-api|${DEV}\n` });
    try {
      const r = reset(dir);
      assert.notEqual(r.code, 0);
      assert.match(r.err, /dream-platform-migrate\((local|prod)\)/);
      assert.deepEqual(lines(dir, "compose-log"), []);
      assert.deepEqual(lines(dir, "rm-log"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("dev mode: stops dev, removes exactly the 26 cache volumes, keeps every data volume", () => {
  const dir = setup({
    psAll: `dream-platform-api|${DEV}\ndream-platform-dev-packages|${DEV}\n`,
    extraVolumes: {
      // Another project with look-alike names must never be touched.
      "other-project_dev-nm-root": "other-project|dev-nm-root\n",
      [`${P}-test_media-data`]: `${P}-test|media-data\n`,
    },
  });
  try {
    const r = reset(dir);
    assert.equal(r.code, 0, r.err);
    const compose = lines(dir, "compose-log");
    assert.equal(compose.length, 1);
    assert.match(compose[0], /compose\.dev\.yaml.* down$/);
    assert.doesNotMatch(compose[0], /remove-orphans|-v\b|--volumes/);
    const removed = lines(dir, "rm-log").sort();
    assert.equal(removed.length, 26);
    for (const v of removed) assert.ok(v.startsWith(`${P}_dev-`));
    assert.deepEqual(left(dir), [
      "dream-petroleum-platform-test_media-data",
      `${P}_dev-media`,
      `${P}_media-data`,
      `${P}_postgres-data`,
      `${P}_postgres-data-dev`,
      `${P}_tls-ca-dev`,
      `${P}_tls-config-dev`,
      "other-project_dev-nm-root",
    ]);
    assert.match(r.err, /removing 26 dev cache volume\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--yes is required and never skips the checks", () => {
  const dir = setup({ psAll: `dream-platform-api|${LOCAL}\n` });
  try {
    const noYes = reset(dir, "");
    assert.notEqual(noYes.code, 0);
    assert.match(noYes.err, /repeat with --yes/);
    const yes = reset(dir, "--yes");
    assert.notEqual(yes.code, 0);
    assert.deepEqual(lines(dir, "rm-log"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unexpected volume state stops before the first removal", () => {
  // Wrong labels on an allow-listed name.
  const wrong = setup();
  try {
    writeFileSync(path.join(wrong, "vol", `${P}_dev-turbo`), "someone-else|dev-turbo\n");
    const r = reset(wrong);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /dev-turbo is not this project's/);
    assert.deepEqual(lines(wrong, "rm-log"), []);
  } finally {
    rmSync(wrong, { recursive: true, force: true });
  }
  // A cache volume still attached to a container (for example of another project).
  const used = setup();
  try {
    writeFileSync(path.join(used, `ps-volume-${P}_dev-nm-root`), "other-app\n");
    const r = reset(used);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /dev-nm-root is used by container\(s\): other-app/);
    assert.deepEqual(lines(used, "rm-log"), []);
  } finally {
    rmSync(used, { recursive: true, force: true });
  }
  // compose down failing: nothing removed.
  const down = setup();
  try {
    writeFileSync(path.join(down, "compose-fails"), "");
    const r = reset(down);
    assert.notEqual(r.code, 0);
    assert.deepEqual(lines(down, "rm-log"), []);
  } finally {
    rmSync(down, { recursive: true, force: true });
  }
});
