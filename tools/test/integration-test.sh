#!/usr/bin/env bash
# Integration tests against a disposable PostgreSQL (ADR-010). Needs only Docker and bash.
#
#   infra/docker/stack.sh test integration
#
# 1. Starts only the test Postgres of the Compose project "dream-petroleum-platform-test"
#    (tmpfs, no port, own network) and creates the shadow database for the drift check.
# 2. Runs, in the toolbox on that network with the dev image (OpenSSL for Prisma's engines):
#    install, build of the API and its packages, `prisma validate`, the drift check
#    (schema vs. migrations, exit 2 = schema changes without a migration), and the Vitest
#    integration suite. Each step is its own command, so `set -e` stops on the first failure
#    (never chain a check with &&: a failing left side does not stop the script).
#    Every URL points at a *_test database only; the suite refuses any other database before
#    connecting. ADR-012A: the test Postgres gets the separated roles from its init script, and
#    each URL is one role: DATABASE_URL = dp_app (the API), MIGRATE_DATABASE_URL = dp_migrator
#    (migrations, iam:sync), IAM_BOOTSTRAP_DATABASE_URL = dp_iam_bootstrap, and
#    TEST_SUPERUSER_DATABASE_URL = the test superuser, used only by the role tests to set up
#    probes. The shadow database for the drift check belongs to the superuser.
# 3. Always removes the test containers and network (no volumes exist).
#
# Heavy job: one at a time under the shared lock, after the resource preflight. Can run next to
# the dev or prod stack if the Docker VM has room; otherwise it fails fast.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../../infra/docker/lib.sh
source "$ROOT/infra/docker/lib.sh"
cd "$ROOT"

RUNNER_MEM="${INTEGRATION_RUNNER_MEM:-1536m}"
PG_MB=512
TEST_URL="postgresql://dp_app:test-only-dp-app-password@postgres:5432/dream_platform_test?schema=public"
MIGRATE_URL="postgresql://dp_migrator:test-only-dp-migrator-pw@postgres:5432/dream_platform_test?schema=public"
BOOTSTRAP_URL="postgresql://dp_iam_bootstrap:test-only-dp-bootstrap-pw@postgres:5432/dream_platform_test?schema=public"
SUPERUSER_URL="postgresql://dream_platform_test:test-only-not-a-secret@postgres:5432/dream_platform_test?schema=public"
SHADOW_URL="postgresql://dream_platform_test:test-only-not-a-secret@postgres:5432/dream_platform_shadow_test?schema=public"
DEV_IMAGE="dream-petroleum-platform-dev:local"

acquire_heavy_lock "integration tests"
resource_check heavy:integration $(( $(to_bytes "$RUNNER_MEM") + PG_MB * MiB )) >&2 ||
  die "resource preflight for the integration tests failed; nothing was started"
docker image inspect "$DEV_IMAGE" >/dev/null 2>&1 ||
  die "$DEV_IMAGE is missing; build it once with: docker compose -f infra/docker/compose.yaml -f infra/docker/compose.dev.yaml --env-file .env.example build dev-install"

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
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_shadow_test
# F1-002 Group 2: the staff-auth end-to-end suite needs an EMPTY database with the same roles.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_auth_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_auth_test >/dev/null
# PM-1: the catalogue suite needs an EMPTY database of its own as well (it adds staff fixtures).
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_catalog_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_catalog_test >/dev/null
# PM-3: the review/publication suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_workflow_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_workflow_test >/dev/null
# PM-5: the technical documents suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_documents_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_documents_test >/dev/null
# PM-6: the cross-references suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_xrefs_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_xrefs_test >/dev/null
# DP-042: the lead-gated downloads suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_leads_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_leads_test >/dev/null
# DP-108: the system owner suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_owner_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_owner_test >/dev/null
# CMS S1 (DP-015): the CMS pages suite starts from an EMPTY database of its own too.
docker exec dream-test-postgres createdb -U dream_platform_test dream_platform_cms_test
DP_APP_PASSWORD=test-only-dp-app-password DP_MIGRATOR_PASSWORD=test-only-dp-migrator-pw \
  DP_IAM_BOOTSTRAP_PASSWORD=test-only-dp-bootstrap-pw \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test dream_platform_cms_test >/dev/null

# Names of the application databases, so the guard refuses them even if a URL were mistyped.
app_db() { awk -F= -v k="$1" '$1==k {v=$2} END {print v}' "$ROOT/.env" 2>/dev/null; }
{
  echo "DATABASE_URL=$TEST_URL"
  echo "MIGRATE_DATABASE_URL=$MIGRATE_URL"
  echo "IAM_BOOTSTRAP_DATABASE_URL=$BOOTSTRAP_URL"
  echo "TEST_SUPERUSER_DATABASE_URL=$SUPERUSER_URL"
  echo "SHADOW_DATABASE_URL=$SHADOW_URL"
  echo "AUTH_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_auth_test}"
  echo "AUTH_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_auth_test}"
  echo "AUTH_IAM_BOOTSTRAP_DATABASE_URL=${BOOTSTRAP_URL/dream_platform_test/dream_platform_auth_test}"
  echo "CATALOG_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_catalog_test}"
  echo "CATALOG_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_catalog_test}"
  echo "WORKFLOW_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_workflow_test}"
  echo "WORKFLOW_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_workflow_test}"
  echo "DOCUMENTS_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_documents_test}"
  echo "DOCUMENTS_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_documents_test}"
  echo "XREFS_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_xrefs_test}"
  echo "XREFS_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_xrefs_test}"
  echo "LEADS_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_leads_test}"
  echo "LEADS_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_leads_test}"
  echo "OWNER_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_owner_test}"
  echo "OWNER_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_owner_test}"
  echo "CMS_DATABASE_URL=${TEST_URL/dream_platform_test/dream_platform_cms_test}"
  echo "CMS_MIGRATE_DATABASE_URL=${MIGRATE_URL/dream_platform_test/dream_platform_cms_test}"
  echo "POSTGRES_DB=$(app_db POSTGRES_DB)"
  echo "DEV_POSTGRES_DB=$(app_db DEV_POSTGRES_DB)"
  echo "PRISMA_HIDE_UPDATE_MESSAGE=1"
} > "$ENV_FILE_TMP"

info "running validate, drift check and integration tests"
TOOLBOX_IMAGE="$DEV_IMAGE" TOOLBOX_NETWORK="${TEST_PROJECT}_default" TOOLBOX_ENV_FILE="$ENV_FILE_TMP" \
  TOOLBOX_MEM="$RUNNER_MEM" TOOLBOX_HEAP_MB=1024 \
  "$ROOT/infra/docker/toolbox.sh" '
    set -e
    pnpm install --frozen-lockfile >/dev/null
    pnpm turbo run build --filter=@dream/api... --output-logs=errors-only
    cd apps/api
    echo "== prisma validate";  pnpm run --silent db:validate
    echo "== drift check (schema vs. migrations)"
    pnpm run --silent db:drift
    echo "no drift"
    echo "== integration tests (through turbo, as in CI: only passThroughEnv variables reach them)"
    cd ../..
    pnpm turbo run test:integration --filter=@dream/api --output-logs=full
  '
info "integration tests passed; test database removed"
