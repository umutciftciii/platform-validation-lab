// DP-277 (ADR-029): the mode and data guards of infra/docker/stack.sh + local-mode.sh, run with a
// fake `docker` on PATH (no Docker needed). The real commands are exercised by the isolated
// production-mode fixture; these tests pin the decisions that keep the DEV data safe:
//  - dev and local never attach the DEV data volumes at the same time;
//  - a mode never starts while another mode's containers run;
//  - pending/unknown migrations are computed exactly, and an unreadable list is an error.
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STACK = path.join(REPO, "infra/docker/stack.sh");

const FAKE_DOCKER = `#!/usr/bin/env bash
# Answers from files in $FAKE: ps-running, ps-volume-<volume>, applied, image-migrations.
args="$*"
case "$1" in
  ps)
    if [[ "$args" == *"volume="* ]]; then
      v="\${args##*volume=}"; v="\${v%% *}"
      cat "$FAKE/ps-volume-$v" 2>/dev/null; exit 0
    fi
    [[ "$args" == *"publish="* ]] && exit 0
    [[ "$args" == *"name=^/dream-platform-"* ]] && exit 0
    cat "$FAKE/ps-running" 2>/dev/null; exit 0 ;;
  exec) [[ -f "$FAKE/applied" ]] || exit 2; cat "$FAKE/applied"; exit 0 ;;
  run) [[ -f "$FAKE/image-migrations" ]] || exit 3; cat "$FAKE/image-migrations"; exit 0 ;;
  *) exit 0 ;;
esac
`;

function setup(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-local-mode-"));
  mkdirSync(path.join(dir, "bin"));
  writeFileSync(path.join(dir, "bin/docker"), FAKE_DOCKER);
  chmodSync(path.join(dir, "bin/docker"), 0o755);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

/** Runs `snippet` in bash after sourcing stack.sh for its functions only. */
function run(dir, snippet) {
  const res = spawnSync(
    "bash",
    ["-c", `set -euo pipefail; source "${STACK}"; port_open() { return 1; }; ${snippet}`],
    {
      env: {
        ...process.env,
        PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
        FAKE: dir,
        DREAM_STACK_SOURCE_ONLY: "1",
      },
      encoding: "utf8",
    },
  );
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const P = "dream-petroleum-platform";
const DEV_FILES = `/r/infra/docker/compose.yaml,/r/infra/docker/compose.dev.yaml`;
const LOCAL_FILES = `/r/infra/docker/compose.yaml,/r/infra/docker/compose.local.yaml`;
const PROD_FILES = `/r/infra/docker/compose.yaml`;

test("the mode of a container comes from its Compose files", () => {
  const dir = setup();
  try {
    const r = run(
      dir,
      `mode_of_files "${DEV_FILES}"; mode_of_files "${LOCAL_FILES}"; mode_of_files "${PROD_FILES}"; mode_prefix local; mode_db_env local`,
    );
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "dev\nlocal\nprod\nDEV_\ndev\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local refuses to start while a dev container is running, and dev while local runs", () => {
  const dir = setup({ "ps-running": `dream-platform-api|${DEV_FILES}\n` });
  try {
    const r = run(dir, "preflight local");
    assert.notEqual(r.code, 0);
    assert.match(r.err, /dev stack is running/);
    writeFileSync(path.join(dir, "ps-running"), `dream-platform-api|${LOCAL_FILES}\n`);
    const d = run(dir, "preflight dev");
    assert.notEqual(d.code, 0);
    assert.match(d.err, /local stack is running/);
    const ok = run(dir, "preflight local");
    assert.equal(ok.code, 0, ok.err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a DEV data volume is never attached to containers of two modes (ADR-029 D3)", () => {
  const dir = setup({
    // A stopped dev container still holds the DEV database volume.
    [`ps-volume-${P}_postgres-data-dev`]: `dream-platform-postgres|${P}|${DEV_FILES}\n`,
  });
  try {
    const r = run(dir, "assert_volumes_free_for local");
    assert.notEqual(r.code, 0);
    assert.match(r.err, /postgres-data-dev, dev mode/);
    const own = run(dir, "assert_volumes_free_for dev");
    assert.equal(own.code, 0, own.err);
    // A container of another project on the media volume blocks both modes.
    writeFileSync(path.join(dir, `ps-volume-${P}_postgres-data-dev`), "");
    writeFileSync(path.join(dir, `ps-volume-${P}_dev-media`), `copy-job|other|\n`);
    const foreign = run(dir, "assert_volumes_free_for local");
    assert.notEqual(foreign.code, 0);
    assert.match(foreign.err, /copy-job\(.*dev-media, project other\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending and unknown migrations are exact; an unreadable list is an error", () => {
  const dir = setup({
    applied: "m1\nm2\nm3\n",
    "image-migrations": "m1\nm2\nm3\nm4\n",
  });
  try {
    const p = run(dir, "migration_diff img pending; echo '--'; migration_diff img unknown");
    assert.equal(p.code, 0, p.err);
    assert.equal(p.out, "m4\n--\n");
    writeFileSync(path.join(dir, "image-migrations"), "m1\nm2\n");
    const u = run(dir, "migration_diff img unknown");
    assert.equal(u.out, "m3\n");
    rmSync(path.join(dir, "image-migrations"));
    const bad = run(dir, "migration_diff img pending && echo PASSED");
    assert.notEqual(bad.code, 0);
    assert.doesNotMatch(bad.out, /PASSED/);
    writeFileSync(path.join(dir, "image-migrations"), "m1\n");
    rmSync(path.join(dir, "applied"));
    const noDb = run(dir, "migration_diff img pending && echo PASSED");
    assert.notEqual(noDb.code, 0);
    assert.doesNotMatch(noDb.out, /PASSED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
