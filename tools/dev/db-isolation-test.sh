#!/usr/bin/env bash
# Regression test for the dev/prod Postgres separation (ADR-009). Needs only Docker and bash.
#
#   tools/dev/db-isolation-test.sh
#
# What it proves:
#   1. Compose maps each mode to its own volume, database and user.
#   2. reset-db refuses a missing mode, a missing --yes, an unknown mode or argument, and a
#      running stack. Its target is checked only with --dry-run: this test never removes a volume.
#   3. With unique, temporary marker rows: what one mode writes, the other cannot see; each mode
#      runs on its own cluster (system identifier) and volume; the API of each mode is connected
#      to that mode's database (/health/ready).
#   4. The prod volume keeps its identity (same cluster, same creation time) across the test.
#
# Mode switches go through stack.sh, so they run one at a time under the heavy-job lock and the
# resource preflight. Every check uses only Postgres and the API, so ISOLATION_DEV_SERVICES=api
# (CI) starts dev mode as the API and its dependencies (dev-install, migrate, postgres) instead
# of the whole hot-reload stack; unset (default) starts all of dev mode, as before. The test restores the mode that was running before it (or leaves the stack
# stopped). The marker schema is dropped in both databases at the end; on failure, a cleanup
# step drops it in whichever mode is running and lists anything left over.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/infra/docker/stack.sh"
PROJECT="dream-petroleum-platform"
PG="dream-platform-postgres"
API_READY="http://127.0.0.1:3113/health/ready"
SCHEMA="f0004_isolation_test"
RUN_ID="$(date +%s)$$"
TOKEN_DEV="dev-$RUN_ID"
TOKEN_PROD="prod-$RUN_ID"
PASS=0
FAIL=0
LEFTOVER=""
read -r -a DEV_SERVICES <<<"${ISOLATION_DEV_SERVICES:-}"

ok() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
check() { # description, command...
  local d="$1"; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}
refused() { # description, stack.sh args... (must exit non-zero)
  local d="$1"; shift
  if "$STACK" "$@" >/dev/null 2>&1; then bad "$d (was accepted)"; else ok "$d"; fi
}
section() { echo; echo "== $*"; }

running_mode() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Label "com.docker.compose.project.config_files"}}' |
    awk 'NF {print (index($0, "compose.dev.yaml") ? "dev" : "prod")}' | sort -u | tr '\n' ' ' | sed 's/ $//'
}

# psql inside the running Postgres container, as that container's own user and database.
sql() {
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$PG" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<<"$1"
}
pg_env() { docker exec "$PG" printenv "$1"; }
volume_of_pg() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$PG"; }
sysid() { sql "select system_identifier from pg_control_system();"; }
markers() { sql "select coalesce(string_agg(token, ',' order by token), '') from $SCHEMA.marker;" 2>/dev/null || echo "<no schema>"; }
# /health/ready probe (ready_code, ready_detail, wait_ready) and credential masking (redact).
# `up --wait` returns once Docker's healthcheck passes, and that probes /health (liveness), not
# /health/ready, so every 200 check waits for readiness first. A connection error while the API
# starts or restarts is retried like a non-200 answer; the 200 check itself is unchanged.
# shellcheck source=tools/dev/lib-readiness.sh
source "$ROOT/tools/dev/lib-readiness.sh"

# On a failed mode switch: what stack.sh said, the engine's capacity, the state of this
# project's containers and the last log lines of the ones that did not come up healthy.
diagnose() { # mode, stack.sh output file
  local mode="$1" out="$2" c
  {
    echo "---- stack.sh $mode up output (last 80 lines, credentials masked)"
    tail -n 80 "$out" | redact
    echo "---- Docker engine: $(docker info -f 'cpus={{.NCPU}} memory={{.MemTotal}} os={{.OperatingSystem}}' 2>/dev/null)"
    echo "---- containers of $PROJECT"
    docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
      --format '{{.Names}}\t{{.Status}}' 2>/dev/null
    for c in $(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
      --format '{{.Names}}|{{.Status}}' | awk -F'|' '$2 !~ /healthy|^Up [0-9]+ [a-z]+$/ && $2 !~ /Exited \(0\)/ {print $1}'); do
      echo "---- $c: last 30 log lines (credentials masked)"
      docker logs --tail 30 "$c" 2>&1 | redact
    done
    echo "----"
  } >&2
}

switch_to() { # stop whatever runs, start the given mode
  local cur out; cur="$(running_mode)"
  [[ "$cur" == "$1" ]] && return 0
  [[ -z "$cur" ]] || "$STACK" "$cur" down >/dev/null 2>&1
  [[ "$1" == none ]] && return 0
  out="$(mktemp)"
  local svcs=()
  if [[ "$1" == dev ]]; then svcs=(${DEV_SERVICES[@]+"${DEV_SERVICES[@]}"}); fi
  if ! "$STACK" "$1" up ${svcs[@]+"${svcs[@]}"} >"$out" 2>&1; then
    echo "error: $1 up failed" >&2
    diagnose "$1" "$out"
    rm -f "$out"
    return 1
  fi
  rm -f "$out"
}

cleanup() {
  local cur; cur="$(running_mode)"
  if [[ -n "$cur" && "$cur" != *" "* ]]; then
    sql "drop schema if exists $SCHEMA cascade;" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup' EXIT

INITIAL="$(running_mode)"
echo "DB isolation test, run $RUN_ID (initial mode: ${INITIAL:-stopped}; dev services: ${ISOLATION_DEV_SERVICES:-all})"

section "1. Compose mapping (rendered config)"
for mode in prod dev; do
  files=(-f "$ROOT/infra/docker/compose.yaml")
  [[ "$mode" == dev ]] && files+=(-f "$ROOT/infra/docker/compose.dev.yaml")
  cfg="$(docker compose -p "$PROJECT" "${files[@]}" --env-file "$ROOT/.env" config postgres api)"
  sources="$(grep -E '^ +source: postgres-data' <<<"$cfg" | awk '{print $2}' | tr '\n' ' ' | sed 's/ $//')"
  db="$(awk '/POSTGRES_DB:/ {print $2}' <<<"$cfg")"
  expected_db="$(awk '/DB_EXPECTED_NAME:/ {print $2}' <<<"$cfg")"
  eval "CFG_${mode}_SOURCES='$sources' CFG_${mode}_DB='$db' CFG_${mode}_EXPECTED='$expected_db'"
done
check "prod mounts only postgres-data (got: $CFG_prod_SOURCES)" test "$CFG_prod_SOURCES" = "postgres-data"
check "dev mounts only postgres-data-dev (got: $CFG_dev_SOURCES)" test "$CFG_dev_SOURCES" = "postgres-data-dev"
check "database names differ (prod=$CFG_prod_DB dev=$CFG_dev_DB)" test "$CFG_prod_DB" != "$CFG_dev_DB"
check "API of each mode expects its own database" \
  test "$CFG_prod_EXPECTED" = "$CFG_prod_DB" -a "$CFG_dev_EXPECTED" = "$CFG_dev_DB"

section "2. reset-db refusals (stack running)"
switch_to prod
PROD_VOL_CREATED="$(docker volume inspect -f '{{.CreatedAt}}' "${PROJECT}_postgres-data")"
refused "reset-db without mode" reset-db --yes
refused "reset-db with no arguments" reset-db
refused "reset-db dev without --yes" reset-db dev
refused "reset-db prod without --yes" reset-db prod
refused "reset-db with unknown mode" reset-db staging --yes
refused "reset-db with unknown argument" reset-db dev --yes --force
refused "reset-db dev --dry-run while a stack runs" reset-db dev --yes --dry-run
refused "reset-db prod --dry-run while a stack runs" reset-db prod --yes --dry-run
refused "migrate dev while prod runs" migrate dev
refused "migrate with unknown mode" migrate staging

section "3. prod mode: identity and marker"
PROD_SYSID="$(sysid)"
check "postgres mounts ${PROJECT}_postgres-data" test "$(volume_of_pg)" = "${PROJECT}_postgres-data"
check "postgres serves database $CFG_prod_DB" test "$(pg_env POSTGRES_DB)" = "$CFG_prod_DB"
wait_ready || true # not ready: the 200 check below reports FAIL with READY_NOTE
check "API /health/ready 200 ($READY_NOTE; $(ready_detail))" test "$(ready_code)" = 200
check "API connected to env=prod db=$CFG_prod_DB" test "$(ready_detail)" = "env=prod db=$CFG_prod_DB"
check "no leftover marker schema in prod" test "$(markers)" = "<no schema>"
sql "create schema $SCHEMA; create table $SCHEMA.marker(token text primary key); insert into $SCHEMA.marker values ('$TOKEN_PROD');"
LEFTOVER="prod"
check "prod marker written ($TOKEN_PROD)" test "$(markers)" = "$TOKEN_PROD"

section "4. dev mode: identity, isolation, marker"
switch_to dev
DEV_SYSID="$(sysid)"
check "postgres mounts ${PROJECT}_postgres-data-dev" test "$(volume_of_pg)" = "${PROJECT}_postgres-data-dev"
check "postgres serves database $CFG_dev_DB" test "$(pg_env POSTGRES_DB)" = "$CFG_dev_DB"
check "dev cluster differs from prod (dev=$DEV_SYSID prod=$PROD_SYSID)" test "$DEV_SYSID" != "$PROD_SYSID"
wait_ready || true # not ready: the 200 check below reports FAIL with READY_NOTE
check "API /health/ready 200 ($READY_NOTE; $(ready_detail))" test "$(ready_code)" = 200
check "API connected to env=dev db=$CFG_dev_DB" test "$(ready_detail)" = "env=dev db=$CFG_dev_DB"
check "prod marker NOT visible in dev" test "$(markers)" = "<no schema>"
check "prod database name not present in dev cluster" \
  test -z "$(sql "select datname from pg_database where datname = '$CFG_prod_DB';")"
sql "create schema $SCHEMA; create table $SCHEMA.marker(token text primary key); insert into $SCHEMA.marker values ('$TOKEN_DEV');"
LEFTOVER="prod dev"
check "dev marker written ($TOKEN_DEV)" test "$(markers)" = "$TOKEN_DEV"
refused "migrate prod while dev runs" migrate prod

section "5. stack stopped, both volumes exist: reset-db targets (dry run only)"
switch_to none
for mode in dev prod; do
  want="${PROJECT}_postgres-data"; [[ "$mode" == dev ]] && want="${PROJECT}_postgres-data-dev"
  out="$("$STACK" reset-db "$mode" --yes --dry-run 2>&1)" || true
  check "reset-db $mode --dry-run targets only $want" grep -q "would remove $want ($mode database)" <<<"$out"
done
check "both database volumes still exist after dry runs" \
  test "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -cE "_postgres-data(-dev)?$")" = 2

section "6. back to prod: data kept, dev data invisible"
switch_to prod
check "same prod cluster as before ($PROD_SYSID)" test "$(sysid)" = "$PROD_SYSID"
check "prod volume creation time unchanged" \
  test "$(docker volume inspect -f '{{.CreatedAt}}' "${PROJECT}_postgres-data")" = "$PROD_VOL_CREATED"
check "prod sees only its own marker ($(markers))" test "$(markers)" = "$TOKEN_PROD"
sql "drop schema $SCHEMA cascade;"
check "prod marker schema dropped" test "$(markers)" = "<no schema>"
LEFTOVER="dev"

section "7. back to dev: dev data kept, then cleaned"
switch_to dev
check "same dev cluster as before ($DEV_SYSID)" test "$(sysid)" = "$DEV_SYSID"
check "dev sees only its own marker ($(markers))" test "$(markers)" = "$TOKEN_DEV"
sql "drop schema $SCHEMA cascade;"
check "dev marker schema dropped" test "$(markers)" = "<no schema>"
LEFTOVER=""

section "8. restore initial mode (${INITIAL:-stopped})"
switch_to "${INITIAL:-none}"
echo "  mode now: $(running_mode)"

echo
echo "Result: $PASS passed, $FAIL failed"
[[ -z "$LEFTOVER" ]] || echo "WARNING: marker schema $SCHEMA may remain in: $LEFTOVER"
(( FAIL == 0 ))
