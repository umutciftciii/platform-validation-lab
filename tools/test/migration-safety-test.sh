#!/usr/bin/env bash
# Migration safety scenarios (ADR-010), only against the disposable test database. Needs only
# Docker and bash, and the app image (built by `stack.sh prod up` or `docker compose build`).
#
#   infra/docker/stack.sh test migrations
#
# Uses the real `migrate` and `api` service definitions of compose.yaml in the separate Compose
# project "dream-petroleum-platform-test" (compose.test.yaml): tmpfs Postgres, no ports, its own
# network. Fixture migrations (apps/api/test/fixtures/migrations) replace the real ones there.
# Every scenario starts from an empty database (down + up; tmpfs) and ends with `down`.
#
#   0. real migrations (F1-001): the runner applies the repository's committed migrations to an
#      empty test database, then the API becomes ready
#   1. happy path: runner exits 0, then the API becomes healthy and ready on the test database
#   2. re-run: a second runner finds nothing pending and changes nothing
#   3. concurrency: two runners at once; Prisma's advisory lock lets one apply, the other waits
#      and no-ops; the migration is recorded exactly once
#   4. lock timeout: the waiting runner gives up after Prisma's timeout and fails, without
#      applying anything twice
#   5. failed migration: the runner exits non-zero, the API container is never started, and a
#      new runner stays blocked until the failure is resolved by a person (no auto-rollback)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../../infra/docker/lib.sh
source "$ROOT/infra/docker/lib.sh"
cd "$ROOT"

FIX="$ROOT/apps/api/test/fixtures/migrations"
APP_IMAGE="${DP_TEST_APP_IMAGE:-dream-petroleum-platform-app:local}"
PRISMA_LOCK_KEY=72707369   # Prisma Migrate's advisory lock id for PostgreSQL
PASS=0
FAIL=0
ok() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
section() { echo; echo "== $*"; }

# Budget: test Postgres 512 + two runners 384 each + API 256 MiB.
acquire_heavy_lock "migration safety tests"
resource_check heavy:migration-tests $(( (512 + 384 + 384 + 256) * MiB )) >&2 ||
  die "resource preflight for the migration tests failed; nothing was started"
docker image inspect "$APP_IMAGE" >/dev/null 2>&1 ||
  die "$APP_IMAGE is missing; build it first (infra/docker/stack.sh prod up)"

cleanup() { test_compose down --remove-orphans >/dev/null 2>&1 || true; rm -rf "$LOCK_DIR"; }
trap cleanup EXIT

REAL="$ROOT/apps/api/prisma/migrations"
fresh_db() { # fixture set, or a migrations directory as $2
  export MIGRATIONS_DIR="${2:-$FIX/$1}"
  test_compose down --remove-orphans >/dev/null 2>&1 || true
  test_compose up -d --wait --no-build postgres >/dev/null 2>&1
  assert_test_postgres
}
sql() { docker exec -i dream-test-postgres psql -X -q -At -U dream_platform_test -d dream_platform_test <<<"$1"; }
applied() { sql "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null;" 2>/dev/null || echo 0; }
failed() { sql "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null;" 2>/dev/null || echo 0; }
runner() { test_compose run --rm --no-deps -T migrate 2>&1; }
api_started() { [[ "$(docker inspect -f '{{.State.StartedAt}}' dream-test-api 2>/dev/null || echo none)" != "0001-01-01T00:00:00Z" && "$(docker inspect -f '{{.State.StartedAt}}' dream-test-api 2>/dev/null || echo none)" != none ]]; }
api_ready_json() { docker exec dream-test-api node -e 'fetch("http://127.0.0.1:3000/health/ready").then(async r=>console.log(r.status, await r.text()))'; }

section "0. real migrations: the runner applies the committed migrations, then the API starts"
fresh_db real "$REAL"
real_count="$(find "$REAL" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if test_compose up -d --wait --no-build api >/dev/null 2>&1; then ok "up api succeeded (migrate exited 0 first)"; else bad "up api failed"; fi
check "migrate container exited 0" test "$(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate)" = 0
check "all $real_count committed migration(s) recorded as applied" test "$(applied)" = "$real_count"
check "IAM tables exist (User, RoleAssignment, AuditEvent)" test "$(sql "select to_regclass('public.\"User\"') is not null and to_regclass('public.\"RoleAssignment\"') is not null and to_regclass('public.\"AuditEvent\"') is not null;")" = t
check "audit append-only trigger installed" test "$(sql "select count(*) from pg_trigger where tgname = 'AuditEvent_append_only';")" = 1
ready="$(api_ready_json)"
check "API ready on the test database ($ready)" grep -q '^200 .*env=test db=dream_platform_test' <<<"$ready"
out="$(runner)" && code=0 || code=$?
check "re-running the runner is a no-op (exit $code)" grep -qi "no pending migrations" <<<"$out"

section "1. happy path: migrate, then the API starts"
fresh_db ok
if test_compose up -d --wait --no-build api >/dev/null 2>&1; then ok "up api succeeded (migrate exited 0 first)"; else bad "up api failed"; fi
check "migrate container exited 0" test "$(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate)" = 0
check "1 migration recorded as applied" test "$(applied)" = 1
check "fixture table exists" test "$(sql "select to_regclass('public.f0005_fixture') is not null;")" = t
ready="$(api_ready_json)"
check "API ready on the test database ($ready)" grep -q '^200 .*env=test db=dream_platform_test' <<<"$ready"

section "2. re-run is a no-op"
out="$(runner)" && code=0 || code=$?
check "second runner exits 0" test "$code" = 0
check "it reports nothing to apply" grep -qi "no pending migrations" <<<"$out"
check "still exactly 1 migration recorded" test "$(applied)" = 1

section "3. two runners at the same time (Prisma advisory lock)"
fresh_db slow
LOG="$(mktemp -d)"
runner >"$LOG/a" 2>&1 & A=$!
sleep 0.3
runner >"$LOG/b" 2>&1 & B=$!
max_granted=0; max_waiting=0
for _ in $(seq 1 24); do
  read -r g w < <(sql "select count(*) filter (where granted), count(*) filter (where not granted) from pg_locks where locktype = 'advisory' and objid = $PRISMA_LOCK_KEY;" | tr '|' ' ') || true
  (( ${g:-0} > max_granted )) && max_granted=$g
  (( ${w:-0} > max_waiting )) && max_waiting=$w
  kill -0 $A 2>/dev/null || kill -0 $B 2>/dev/null || break
  sleep 0.5
done
wait $A && ca=0 || ca=$?
wait $B && cb=0 || cb=$?
check "advisory lock $PRISMA_LOCK_KEY held by one runner at a time (max granted $max_granted)" test "$max_granted" = 1
check "the other runner waited on it (max waiting $max_waiting)" test "$max_waiting" -ge 1
check "both runners exit 0 (exit $ca, $cb)" test "$ca$cb" = 00
check "exactly one applied the migration" test "$(grep -l "following migration(s) have been applied" "$LOG/a" "$LOG/b" | wc -l | tr -d ' ')" = 1
check "migration recorded exactly once" test "$(applied)" = 1

section "4. lock wait timeout: the second runner fails, nothing is applied twice"
fresh_db very-slow
runner >"$LOG/c" 2>&1 & C=$!
sleep 1
runner >"$LOG/d" 2>&1 && cd_=0 || cd_=$?
wait $C && cc=0 || cc=$?
check "first runner exits 0" test "$cc" = 0
check "second runner fails (exit $cd_)" test "$cd_" -ne 0
check "it failed on the advisory lock timeout" grep -qi "advisory lock" "$LOG/d"
check "migration recorded exactly once" test "$(applied)" = 1
sed -n '/advisory lock/{p;q;}' "$LOG/d" | cut -c1-160 | sed 's/^/        /'

section "5. failed migration: the API must not start"
fresh_db fail
if test_compose up -d --wait --no-build api >"$LOG/e" 2>&1; then bad "up api succeeded despite a failing migration"; else ok "up api refused"; fi
check "compose names the failed dependency" grep -q 'migrate.*didn.t complete successfully' "$LOG/e"
check "migrate container exited non-zero ($(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate))" \
  test "$(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate)" != 0
if api_started; then bad "API container was started"; else ok "API container never started"; fi
check "first migration applied, failed one recorded as unfinished" test "$(applied)/$(failed)" = 1/1
out="$(runner)" && code=0 || code=$?
check "a new runner stays blocked (exit $code)" test "$code" -ne 0
check "it asks for a manual resolution (P3009)" grep -q "P3009" <<<"$out"
if api_started; then bad "API container was started"; else ok "API still not started"; fi

rm -rf "$LOG"
echo
echo "Result: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
