// DP-277 (ADR-029): the mode and data guards of infra/docker/stack.sh + local-mode.sh, run with a
// fake `docker` on PATH (no Docker needed). The real commands are exercised by the isolated
// production-mode fixture; these tests pin the decisions that keep the DEV data safe:
//  - dev and local never attach the DEV data volumes at the same time;
//  - a mode never starts while another mode's containers run;
//  - pending/unknown migrations are computed exactly, and an unreadable list is an error.
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync } from "node:fs";
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
    [[ "$args" == "ps -a --filter label="* ]] && { cat "$FAKE/ps-all" 2>/dev/null; exit 0; }
    cat "$FAKE/ps-running" 2>/dev/null; exit 0 ;;
  exec) [[ -f "$FAKE/applied" ]] || exit 2; cat "$FAKE/applied"; exit 0 ;;
  run) [[ -f "$FAKE/image-migrations" ]] || exit 3; cat "$FAKE/image-migrations"; exit 0 ;;
  image)
    # image inspect -f <format> <name>: $FAKE/img/<name> holds "<id> <revision>".
    name="\${@: -1}"; f="$FAKE/img/$name"
    [[ -f "$f" ]] || exit 1
    read -r id rev < "$f"
    if [[ "$args" == *".Id"* ]]; then echo "$id"; else echo "$rev"; fi; exit 0 ;;
  tag)
    [[ -f "$FAKE/img/$2" ]] || exit 1
    cp "$FAKE/img/$2" "$FAKE/img/$3"; echo "$3" >> "$FAKE/tag-log"; exit 0 ;;
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
        DP_LOCAL_STATE_DIR: path.join(dir, "state"),
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

// DP-280: the first-install bootstrap of `sync-main --bootstrap`.
const L = "dream-petroleum-platform-local";
const SHA1 = "1".repeat(40);
const SHA0 = "0".repeat(40);
function images(dir, map) {
  mkdirSync(path.join(dir, "img"), { recursive: true });
  for (const [name, content] of Object.entries(map))
    writeFileSync(path.join(dir, "img", name), content);
}
const read = (dir, name) => {
  try {
    return readFileSync(path.join(dir, "img", name), "utf8").trim();
  } catch {
    return null;
  }
};

test("first install: the tested image becomes :current, :previous is not created", () => {
  const dir = setup();
  try {
    images(dir, { [`${L}:111111111111`]: `sha256:new ${SHA1}` });
    const r = run(dir, `bootstrap_precheck ${SHA1} && bootstrap_promote ${L}:111111111111 ${SHA1}`);
    assert.equal(r.code, 0, r.err);
    assert.equal(read(dir, `${L}:current`), `sha256:new ${SHA1}`);
    assert.equal(read(dir, `${L}:previous`), null);
    assert.match(r.err, /first install/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a repeated bootstrap of the same commit changes nothing", () => {
  const dir = setup();
  try {
    images(dir, {
      [`${L}:111111111111`]: `sha256:new ${SHA1}`,
      [`${L}:current`]: `sha256:new ${SHA1}`,
    });
    const r = run(dir, `bootstrap_precheck ${SHA1} && bootstrap_promote ${L}:111111111111 ${SHA1}`);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /nothing changed/);
    assert.equal(read(dir, `${L}:current`), `sha256:new ${SHA1}`);
    assert.equal(read(dir, "../tag-log"), null, "no docker tag call");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing installation is never replaced by the bootstrap (:current and :previous kept)", () => {
  const dir = setup();
  try {
    images(dir, {
      [`${L}:111111111111`]: `sha256:new ${SHA1}`,
      [`${L}:current`]: `sha256:old ${SHA0}`,
      [`${L}:previous`]: `sha256:older ${"9".repeat(40)}`,
    });
    const pre = run(dir, `bootstrap_precheck ${SHA1}`);
    assert.notEqual(pre.code, 0);
    assert.match(
      pre.err,
      /an installation exists .*000000000000.*Update with: infra\/docker\/stack.sh sync-main/,
    );
    // Even if the precheck were skipped, the promotion refuses another image.
    const pro = run(dir, `bootstrap_promote ${L}:111111111111 ${SHA1}`);
    assert.notEqual(pro.code, 0);
    assert.equal(read(dir, `${L}:current`), `sha256:old ${SHA0}`);
    assert.equal(read(dir, `${L}:previous`), `sha256:older ${"9".repeat(40)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no bootstrap while local-mode containers exist without :current", () => {
  const dir = setup({ "ps-all": `dream-platform-api|${LOCAL_FILES}\n` });
  try {
    images(dir, { [`${L}:111111111111`]: `sha256:new ${SHA1}` });
    const r = run(dir, `bootstrap_precheck ${SHA1}`);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /local-mode containers exist \(dream-platform-api\)/);
    // A dev-mode container is not a local installation.
    writeFileSync(path.join(dir, "ps-all"), `dream-platform-api|${DEV_FILES}\n`);
    assert.equal(run(dir, `bootstrap_precheck ${SHA1}`).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only the tested image of that commit is promoted", () => {
  const dir = setup();
  try {
    images(dir, { [`${L}:111111111111`]: `sha256:new ${SHA0}` });
    const r = run(dir, `bootstrap_promote ${L}:111111111111 ${SHA1}`);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /not the tested image/);
    assert.equal(read(dir, `${L}:current`), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
