#!/usr/bin/env bash
# DP-125 performance comparison of the IAM paths before and after row-level security, against a
# disposable PostgreSQL only (ADR-010). Needs only Docker and bash.
#
#   tools/perf/dp125-rls-bench.sh [output.md]
#
# 1. Starts only the test Postgres of the Compose project "dream-petroleum-platform-test" (tmpfs,
#    no port, own network) and creates the database dream_platform_perf_test with the ADR-012A
#    roles.
# 2. In the toolbox (dev image): install, build of the API, `prisma migrate deploy` as
#    dp_migrator, then apps/api/scripts/dp125-rls-bench.mjs. The script seeds staff, role
#    assignments, memberships and audit events, and times the same API paths with RLS off and the
#    old code path ("before") and with RLS on and the staff-context code path ("after"): p50, p95
#    and p99 per scenario.
# 3. Always removes the test containers and network (no volumes exist).
#
# Heavy job: one at a time under the shared lock, after the resource preflight (as the
# integration tests). Never touches the dev or prod database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../../infra/docker/lib.sh
source "$ROOT/infra/docker/lib.sh"
cd "$ROOT"

OUT="${1:-}"
RUNNER_MEM="${PERF_RUNNER_MEM:-1536m}"
PG_MB=512
DB=dream_platform_perf_test
APP_URL="postgresql://dp_app:test-only-dp-app-password@postgres:5432/$DB?schema=public"
MIGRATE_URL="postgresql://dp_migrator:test-only-dp-migrator-pw@postgres:5432/$DB?schema=public"
SUPERUSER_URL="postgresql://dream_platform_test:test-only-not-a-secret@postgres:5432/$DB?schema=public"
DEV_IMAGE="dream-petroleum-platform-dev:local"

acquire_heavy_lock "DP-125 RLS benchmark"
resource_check heavy:integration $(( $(to_bytes "$RUNNER_MEM") + PG_MB * MiB )) >&2 ||
  die "resource preflight for the benchmark failed; nothing was started"
docker image inspect "$DEV_IMAGE" >/dev/null 2>&1 || die "$DEV_IMAGE is missing"

ENV_FILE_TMP="$(mktemp)"
cleanup() {
  rm -f "$ENV_FILE_TMP"
  test_compose down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

info "starting the disposable test database"
test_compose down --remove-orphans >/dev/null 2>&1 || true
test_compose up -d --wait --no-build postgres >/dev/null
assert_test_postgres
docker exec dream-test-postgres createdb -U dream_platform_test "$DB"
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test "$DB" >/dev/null

{
  echo "PERF_APP_URL=$APP_URL"
  echo "PERF_MIGRATE_URL=$MIGRATE_URL"
  echo "MIGRATE_DATABASE_URL=$MIGRATE_URL"
  echo "PERF_SUPERUSER_URL=$SUPERUSER_URL"
  echo "PERF_ITERATIONS=${PERF_ITERATIONS:-1000}"
  echo "PERF_WARMUP=${PERF_WARMUP:-100}"
  echo "PERF_STAFF=${PERF_STAFF:-400}"
  echo "PERF_EVENTS=${PERF_EVENTS:-50000}"
  echo "PRISMA_HIDE_UPDATE_MESSAGE=1"
} > "$ENV_FILE_TMP"

info "building the API and running the benchmark"
TOOLBOX_IMAGE="$DEV_IMAGE" TOOLBOX_NETWORK="${TEST_PROJECT}_default" TOOLBOX_ENV_FILE="$ENV_FILE_TMP" \
  TOOLBOX_MEM="$RUNNER_MEM" TOOLBOX_HEAP_MB=1024 \
  "$ROOT/infra/docker/toolbox.sh" '
    set -e
    pnpm install --frozen-lockfile >/dev/null
    pnpm turbo run build --filter=@dream/api... --output-logs=errors-only >/dev/null
    cd apps/api
    pnpm exec prisma migrate deploy >/dev/null
    echo "=====REPORT====="
    node scripts/dp125-rls-bench.mjs
  ' | tee "${OUT:-/dev/null}"
info "benchmark finished; test database removed"
