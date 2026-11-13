# shellcheck shell=bash
# Shared helpers for stack.sh and toolbox.sh: the resource budget check and the heavy-job lock.
# Sourced, not executed. Expects ROOT (repo root) to be set.
#
# Heavy jobs (image builds, `up` with dependency install, toolbox builds, the check build) run
# one at a time: a second one fails fast instead of waiting, and none starts unless the Docker
# VM keeps DREAM_MEM_RESERVE_MB (default 1024) plus a safety margin free for other projects after
# granting the job its estimated peak and the running containers a growth allowance
# (resource-policy.mjs, DP-116).

PROJECT="${PROJECT:-dream-petroleum-platform}"
TEST_PROJECT="$PROJECT-test"   # disposable test stack (compose.test.yaml, ADR-010)
NODE_IMAGE="${NODE_IMAGE:-node:24.22.2-bookworm-slim}"
MiB=$((1024 * 1024))
# Budgets of the heavy one-off jobs. The toolbox container is hard-limited to TOOLBOX_MEM; the
# BuildKit build of the prod image cannot be limited per build on Docker Desktop, so it is capped
# through turbo concurrency (turbo.json) and the Node heap in the Dockerfile and budgeted here.
TOOLBOX_MEM="${TOOLBOX_MEM:-3072m}"
TOOLBOX_CPUS="${TOOLBOX_CPUS:-4}"
TOOLBOX_HEAP_MB="${TOOLBOX_HEAP_MB:-1536}"
# Measured 2026-11-12 (DP-116): the check build alone peaked at 2808 MiB of VM memory.
BUILD_BUDGET_MB="${BUILD_BUDGET_MB:-3072}"
RESERVE_MB="${DREAM_MEM_RESERVE_MB:-1024}"
LOCK_DIR="$ROOT/.dream-heavy.lock"   # git-ignored

die() { echo "error: $*" >&2; exit 1; }
info() { echo "› $*" >&2; }

to_bytes() { # 3072m | 3g | 1536 (MiB); bash 3.2 compatible (macOS /bin/bash)
  local v="$1"
  case "$v" in
    *[gG]) echo $(( ${v%[gG]} * 1024 * MiB )) ;;
    *[mM]) echo $(( ${v%[mM]} * MiB )) ;;
    *) echo $(( v * MiB )) ;;
  esac
}

# resource_check <job> <jobBytes> [compose args...]
#   job: dev | prod | heavy:<name> | report. With compose args, the rendered config of that
#   mode is the plan: every service, or only PLAN_SERVICES and their dependencies when that
#   array is set (`stack.sh <mode> up <service>...`). Prints the budget table; returns non-zero
#   if the job must not start.
PLAN_SERVICES=()
resource_check() {
  local job="$1" bytes="$2"; shift 2
  local ids
  # Containers of the app stack and of the disposable test stack both count.
  ids="$( { docker ps -q --filter "label=com.docker.compose.project=$PROJECT"
            docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJECT"; } | tr '\n' ' ')"
  ids="${ids% }"
  {
    if (( $# )); then
      docker compose "$@" config --format json ${PLAN_SERVICES[@]+"${PLAN_SERVICES[@]}"}
    else echo '{}'; fi
    printf '\n@@\n'
    if [[ -n "$ids" ]]; then docker inspect $ids; else echo '[]'; fi
    printf '\n@@\n'
    if [[ -n "$ids" ]]; then docker stats --no-stream --format '{{json .}}' $ids; fi
  } | docker run --rm -i --memory 64m --memory-swap 64m --network none \
        --label "com.dream-petroleum.platform=resource-check" \
        -v "$ROOT/infra/docker/resource-check.mjs:/check.mjs:ro" \
        -v "$ROOT/infra/docker/resource-policy.mjs:/resource-policy.mjs:ro" \
        "$NODE_IMAGE" node /check.mjs "$job" "$bytes" $(( RESERVE_MB * MiB ))
}

# Fail fast if another heavy job of this repo holds the lock or a toolbox container is running.
# The lock is released when the calling shell exits (trap), and a stale lock (dead pid) is taken
# over. A job started by the lock holder itself (for example the toolbox run inside the
# integration tests) inherits the lock through DREAM_HEAVY_LOCK_OWNER instead of failing; the
# holder already budgeted for it.
heavy_lock_inherited() {
  [[ -n "${DREAM_HEAVY_LOCK_OWNER:-}" && -f "$LOCK_DIR/owner" ]] &&
    [[ "$(cut -d' ' -f1 "$LOCK_DIR/owner")" == "$DREAM_HEAVY_LOCK_OWNER" ]]
}

acquire_heavy_lock() {
  local name="$1" holder
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    holder="$(cat "$LOCK_DIR/owner" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && kill -0 "${holder%% *}" 2>/dev/null; then
      die "another heavy job is running (pid/job: $holder). Heavy jobs run one at a time; wait for it or stop it."
    fi
    info "removing stale heavy-job lock (${holder:-no owner})"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || die "could not take the heavy-job lock"
  fi
  echo "$$ $name" > "$LOCK_DIR/owner"
  export DREAM_HEAVY_LOCK_OWNER="$$"
  trap 'rm -rf "$LOCK_DIR"' EXIT
  local busy
  busy="$(docker ps -q --filter 'label=com.dream-petroleum.platform=toolbox')"
  [[ -z "$busy" ]] || die "a toolbox container is still running ($busy); heavy jobs run one at a time"
}

# docker compose for the disposable test stack. Uses .env.example for the interpolation that
# compose.yaml needs; every database value is overridden by compose.test.yaml.
test_compose() {
  docker compose -p "$TEST_PROJECT" -f "$ROOT/infra/docker/compose.yaml" \
    -f "$ROOT/infra/docker/compose.test.yaml" --env-file "$ROOT/.env.example" "$@"
}

# Fail unless the running test Postgres is the disposable test database (label db-env=test,
# tmpfs data, database dream_platform_test). Every test script calls this before any SQL.
# Its only mounts may be the two read-only ADR-012A role-setup binds (/dp and the init hook); a
# volume, a writable mount or anything on the data directory means it is not disposable.
assert_test_postgres() {
  local c="dream-test-postgres" label db mounts m
  label="$(docker inspect -f '{{index .Config.Labels "com.dream-petroleum.platform.db-env"}}' "$c" 2>/dev/null)" ||
    die "$c is not running"
  db="$(docker exec "$c" printenv POSTGRES_DB)"
  mounts="$(docker inspect -f '{{range .Mounts}}{{.Type}}:{{.Destination}}:{{.RW}} {{end}}' "$c")"
  for m in $mounts; do
    case "$m" in
      bind:/dp:false | bind:/docker-entrypoint-initdb.d:false) ;;
      *) die "$c is not the disposable test database (unexpected mount $m); refusing" ;;
    esac
  done
  [[ "$label" == test && "$db" == dream_platform_test ]] ||
    die "$c is not the disposable test database (label=$label db=$db); refusing"
  [[ -n "$(docker inspect -f '{{index .HostConfig.Tmpfs "/var/lib/postgresql/data"}}' "$c")" ]] ||
    die "$c has no tmpfs data directory; refusing"
}
