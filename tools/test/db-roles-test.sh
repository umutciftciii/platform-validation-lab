#!/usr/bin/env bash
# ADR-012A role separation end to end (F1-002 Group 0, DP-078), only against the disposable test
# database. Needs only Docker and bash, and the app image (built by `stack.sh prod up`).
#
#   infra/docker/stack.sh test roles
#
# Uses the real postgres, migrate and api service definitions of compose.yaml in the separate
# Compose project "dream-petroleum-platform-test" (compose.test.yaml): tmpfs Postgres, no ports, its
# own network. Two scenarios, each from an empty database and ending with `down`:
#
#   A. New database: the init script creates the roles; the runner migrates as dp_migrator; the
#      API connects as dp_app and is ready; the credentials of each container are only its own;
#      iam sync (dp_migrator) and the bootstrap (dp_iam_bootstrap) work through the operator
#      path; the role setup is idempotent.
#   B. Existing database (the state of every database created before ADR-012A): no roles, the
#      three F1-001 migrations applied by the superuser, data present. The new runner refuses to
#      start until the roles exist (the API never starts); `apply-roles.sh` (= stack.sh db-roles)
#      transfers ownership; the runner then applies only the ADR-012A migration; data, migration
#      history and guards are unchanged; the API is ready as dp_app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../../infra/docker/lib.sh
source "$ROOT/infra/docker/lib.sh"
cd "$ROOT"

APP_IMAGE="${DP_TEST_APP_IMAGE:-dream-petroleum-platform-app:local}"
REAL="$ROOT/apps/api/prisma/migrations"
G0_MIGRATION="20261110230000_adr_012a_database_roles"
# Test placeholders from compose.test.yaml (the database is unreachable from the host).
APP_PW="test-only-dp-app-password"
MIG_PW="test-only-dp-migrator-pw"
BOOT_PW="test-only-dp-bootstrap-pw"
SU_PW="test-only-not-a-secret"
SU_URL="postgresql://dream_platform_test:${SU_PW}@postgres:5432/dream_platform_test?schema=public"
BOOT_URL="postgresql://dp_iam_bootstrap:${BOOT_PW}@postgres:5432/dream_platform_test?schema=public"
PASS=0
FAIL=0
ok() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
section() { echo; echo "== $*"; }

# Budget: test Postgres 512 + runner 384 + API 256 MiB.
acquire_heavy_lock "db roles tests"
resource_check heavy:db-roles-tests $(( (512 + 384 + 256) * MiB )) >&2 ||
  die "resource preflight for the db roles tests failed; nothing was started"
docker image inspect "$APP_IMAGE" >/dev/null 2>&1 ||
  die "$APP_IMAGE is missing; build it first (infra/docker/stack.sh prod up)"
export DP_TEST_APP_IMAGE="$APP_IMAGE"

WORK="$(mktemp -d)"
cleanup() {
  test_compose down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK" "$LOCK_DIR"
}
trap cleanup EXIT

sql() { docker exec -i dream-test-postgres psql -X -q -At -v ON_ERROR_STOP=1 -U dream_platform_test -d dream_platform_test <<<"$1"; }
fresh_db() { # $1 = init hook directory (default: the real one)
  if [[ -n "${1:-}" ]]; then export DP_INITDB_DIR="$1"; else unset DP_INITDB_DIR; fi
  test_compose down --remove-orphans >/dev/null 2>&1 || true
  test_compose up -d --wait --no-build postgres >/dev/null 2>&1
  assert_test_postgres
}
applied() { sql "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null;" 2>/dev/null || echo 0; }
ready_json() { docker exec dream-test-api node -e 'fetch("http://127.0.0.1:3000/health/ready").then(async r=>console.log(r.status, await r.text()))'; }
api_started() { local s; s="$(docker inspect -f '{{.State.StartedAt}}' dream-test-api 2>/dev/null || echo none)"; [[ "$s" != none && "$s" != "0001-01-01T00:00:00Z" ]]; }
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1"; }
# Everything ADR-012A decides, in one comparable text: roles, memberships, settings, database
# ACL, owners of every object in public, and the grants of the dp_* roles.
role_state() {
  sql "
    select 'role', rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolbypassrls
      from pg_roles where rolname like 'dp\_%' order by 2;
    select 'member', g.rolname, m.rolname, am.inherit_option, am.set_option, am.admin_option
      from pg_auth_members am join pg_roles g on g.oid = am.roleid join pg_roles m on m.oid = am.member
      where g.rolname like 'dp\_%' or m.rolname like 'dp\_%' order by 2, 3;
    select 'setting', r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole order by 2;
    select 'dbacl', datacl from pg_database where datname = current_database();
    select 'owner', c.relname, pg_get_userbyid(c.relowner) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by 2;
    select 'grant', grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants where grantee like 'dp\_%' group by 2, 3 order by 2, 3;"
}
not_owned_by_dp_owner() {
  sql "select count(*) from (
         select c.relowner o from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
         union all select p.proowner from pg_proc p where p.pronamespace = 'public'::regnamespace
         union all select t.typowner from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e','d')
         union all select nspowner from pg_namespace where nspname = 'public') x
       where o <> 'dp_owner'::regrole;"
}

section "A. new database: roles from the init script, runner as dp_migrator, API as dp_app"
fresh_db
check "init script created the six roles (DP-096: dp_lead_retention)" \
  test "$(sql "select string_agg(rolname, ',' order by rolname) from pg_roles where rolname like 'dp\_%';")" = \
  "dp_app,dp_iam_bootstrap,dp_iam_system,dp_lead_retention,dp_migrator,dp_owner"
if test_compose up -d --wait --no-build api >/dev/null 2>&1; then ok "up api succeeded (migrate exited 0 first)"; else bad "up api failed"; fi
check "migrate container exited 0" test "$(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate)" = 0
real_count="$(find "$REAL" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
check "all $real_count migrations applied" test "$(applied)" = "$real_count"
check "every object in public is owned by dp_owner" test "$(not_owned_by_dp_owner)" = 0
check "migration history written by the runner as dp_owner" \
  test "$(sql "select pg_get_userbyid(relowner) from pg_class where relname = '_prisma_migrations';")" = dp_owner
ready="$(ready_json)"
check "API ready as a least-privileged role ($ready)" grep -q '^200 .*env=test db=dream_platform_test' <<<"$ready"
check "the API's connections are all dp_app" \
  test "$(sql "select string_agg(distinct usename, ',') from pg_stat_activity where datname = current_database() and client_addr = '$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' dream-test-api)';")" = dp_app

section "A2. each container holds only its own credential"
api_env="$(env_of dream-test-api)"
mig_env="$(env_of dream-test-migrate)"
pg_env="$(env_of dream-test-postgres)"
check "API DATABASE_URL is dp_app" grep -q '^DATABASE_URL=postgresql://dp_app:' <<<"$api_env"
check "API has no migrator URL" bash -c '! grep -q "^MIGRATE_DATABASE_URL=" <<<"$1"' _ "$api_env"
check "API has no bootstrap URL or password" bash -c '! grep -Eq "IAM_BOOTSTRAP|DP_IAM_BOOTSTRAP_PASSWORD|$2" <<<"$1"' _ "$api_env" "$BOOT_PW"
check "API has neither the migrator nor the superuser password" bash -c '! grep -Eq "$2|$3|POSTGRES_PASSWORD" <<<"$1"' _ "$api_env" "$MIG_PW" "$SU_PW"
check "runner MIGRATE_DATABASE_URL is dp_migrator" grep -q '^MIGRATE_DATABASE_URL=postgresql://dp_migrator:' <<<"$mig_env"
check "runner has no API, bootstrap or superuser credential" bash -c '! grep -Eq "^DATABASE_URL=|IAM_BOOTSTRAP|$2|$3|$4" <<<"$1"' _ "$mig_env" "$APP_PW" "$BOOT_PW" "$SU_PW"
check "API process environment has no bootstrap credential" \
  bash -c '! docker exec dream-test-api sh -c "cat /proc/1/environ /proc/self/environ 2>/dev/null | tr \"\\0\" \"\\n\"" | grep -Eq "IAM_BOOTSTRAP|$1"' _ "$BOOT_PW"
check "only Postgres (the init script) holds the role passwords" grep -q '^DP_IAM_BOOTSTRAP_PASSWORD=' <<<"$pg_env"

section "A3. operator path: iam sync as dp_migrator, bootstrap as dp_iam_bootstrap"
out="$(test_compose run --rm --no-deps -T migrate node dist/iam/iam-cli.js sync --confirm-database dream_platform_test 2>&1)" && code=0 || code=$?
check "iam sync exits 0 as dp_migrator (exit $code)" test "$code" = 0
check "iam sync reports the catalogue" grep -q '"roles":' <<<"$out"
out="$(test_compose run --rm --no-deps -T -e MIGRATE_DATABASE_URL= migrate node dist/iam/iam-cli.js bootstrap --email g0.admin@example.test --confirm-database dream_platform_test 2>&1)" && code=0 || code=$?
check "bootstrap without its credential refuses (exit $code)" grep -q "IAM_BOOTSTRAP_DATABASE_URL is not set" <<<"$out"
out="$(test_compose run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e IAM_BOOTSTRAP_DATABASE_URL="$SU_URL" migrate node dist/iam/iam-cli.js bootstrap --email g0.admin@example.test --confirm-database dream_platform_test 2>&1)" && code=0 || code=$?
check "bootstrap with the superuser credential refuses (exit $code)" grep -q "must run as dp_iam_bootstrap" <<<"$out"
out="$(test_compose run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e IAM_BOOTSTRAP_DATABASE_URL="$BOOT_URL" migrate node dist/iam/iam-cli.js bootstrap --email g0.admin@example.test --confirm-database dream_platform_test 2>&1)" && code=0 || code=$?
check "bootstrap as dp_iam_bootstrap succeeds (exit $code)" grep -q "platform administrator assigned" <<<"$out"
check "exactly one active platform administrator, PENDING, no password" \
  test "$(sql "select count(*) from \"RoleAssignment\" ra join \"Role\" r on r.id = ra.\"roleId\" join \"User\" u on u.id = ra.\"userId\" where r.key = 'platform_super_admin' and ra.\"revokedAt\" is null and u.status = 'PENDING' and u.\"passwordHash\" is null;")" = 1
out="$(test_compose run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e IAM_BOOTSTRAP_DATABASE_URL="$BOOT_URL" migrate node dist/iam/iam-cli.js bootstrap --email g0.other@example.test --confirm-database dream_platform_test 2>&1)" && code=0 || code=$?
check "a second bootstrap is refused (exit $code)" grep -q "already exists" <<<"$out"

section "A4. the role setup is idempotent"
before="$(role_state)"
DP_APP_PASSWORD="$APP_PW" DP_MIGRATOR_PASSWORD="$MIG_PW" DP_IAM_BOOTSTRAP_PASSWORD="$BOOT_PW" \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test >/dev/null && code=0 || code=$?
check "apply-roles exits 0 on an initialised database (exit $code)" test "$code" = 0
after="$(role_state)"
check "roles, memberships, ACLs, owners and grants unchanged" test "$before" = "$after"
DP_APP_PASSWORD=short DP_MIGRATOR_PASSWORD="$MIG_PW" DP_IAM_BOOTSTRAP_PASSWORD="$BOOT_PW" \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test >"$WORK/weak" 2>&1 && code=0 || code=$?
check "apply-roles refuses a weak password (exit $code)" grep -q "at least 16 characters" "$WORK/weak"
DP_APP_PASSWORD="$MIG_PW" DP_MIGRATOR_PASSWORD="$MIG_PW" DP_IAM_BOOTSTRAP_PASSWORD="$BOOT_PW" \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test >"$WORK/shared" 2>&1 && code=0 || code=$?
check "apply-roles refuses a password shared by two roles (exit $code)" grep -q "all different" "$WORK/shared"
check "a refused run changed nothing" test "$(role_state)" = "$after"

section "B. existing database without roles (pre-ADR-012A), upgraded in place"
mkdir -p "$WORK/no-init" "$WORK/legacy"
chmod 0755 "$WORK/no-init"
# A pre-ADR-012A database has only the migrations older than ADR-012A. Later ones (F1-002 M1
# onwards) need the roles and are applied by the new runner after the upgrade.
later_count=0
for m in "$REAL"/*/; do
  name="$(basename "$m")"
  if [[ "$name" == "$G0_MIGRATION" || "$name" > "$G0_MIGRATION" ]]; then
    later_count=$((later_count + 1))
    continue
  fi
  cp -R "$m" "$WORK/legacy/$name"
done
cp "$REAL/migration_lock.toml" "$WORK/legacy/" 2>/dev/null || true
fresh_db "$WORK/no-init"
check "no dp_* roles exist (old database)" test "$(sql "select count(*) from pg_roles where rolname like 'dp\_%';")" = 0
# The old wiring: the superuser runs the F1-001 migrations, as every existing database was built.
out="$(MIGRATIONS_DIR="$WORK/legacy" test_compose run --rm --no-deps -T -e MIGRATE_DATABASE_URL="$SU_URL" migrate 2>&1)" && code=0 || code=$?
check "superuser applied the $(find "$WORK/legacy" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') legacy migrations (exit $code)" test "$code" = 0
legacy_count="$(applied)"
sql "
  insert into \"User\" (id, email, \"emailNormalized\", kind, status, \"updatedAt\")
    values (gen_random_uuid(), 'Legacy.Staff@example.test', 'legacy.staff@example.test', 'STAFF', 'PENDING', now()),
           (gen_random_uuid(), 'legacy.customer@example.test', 'legacy.customer@example.test', 'CUSTOMER', 'ACTIVE', now());
  -- F1-002 M1 refuses to run over an ACTIVE user without a verified e-mail (its precheck, covered
  -- by the integration suite); this legacy fixture is consistent data.
  update \"User\" set \"emailVerifiedAt\" = now() where status = 'ACTIVE';
  insert into \"AuditEvent\" (id, \"actorType\", action, \"resourceType\", \"scopeType\", outcome)
    values (gen_random_uuid(), 'SYSTEM', 'test.legacy_event', 'test', 'PLATFORM', 'SUCCESS');" >/dev/null
# The audit fingerprint lists the columns of the legacy table explicitly: later migrations may add
# columns (DP-108: stream and the hash chain), which must not count as a change of the old rows.
fingerprint() {
  sql "select md5(string_agg(u::text, '|' order by u.id)) from \"User\" u;
       select md5(string_agg(row(a.id, a.\"occurredAt\", a.\"actorType\", a.\"actorUserId\", a.action,
              a.\"resourceType\", a.\"resourceId\", a.\"scopeType\", a.\"siteId\", a.outcome, a.reason,
              a.metadata, a.\"requestId\")::text, '|' order by a.id)) from \"AuditEvent\" a;
       select md5(string_agg(migration_name || ':' || checksum, '|' order by migration_name)) from _prisma_migrations;
       select count(*) from pg_trigger where not tgisinternal;"
}
fp_before="$(fingerprint)"
check "legacy objects are owned by the superuser" \
  test "$(sql "select pg_get_userbyid(relowner) from pg_class where relname = 'User';")" = dream_platform_test

# The new runner on the old database: it must fail, and the API must not start.
if test_compose up -d --wait --no-build api >"$WORK/early" 2>&1; then bad "up api succeeded without roles"; else ok "up api refused without roles"; fi
check "migrate container exited non-zero" test "$(docker inspect -f '{{.State.ExitCode}}' dream-test-migrate)" != 0
if api_started; then bad "API container was started"; else ok "API container never started"; fi
check "nothing was applied by the failed runner" test "$(applied)" = "$legacy_count"
test_compose rm -fsv migrate api >/dev/null 2>&1 || true

# The operator step (= stack.sh db-roles): roles, ownership, database ACL.
DP_APP_PASSWORD="$APP_PW" DP_MIGRATOR_PASSWORD="$MIG_PW" DP_IAM_BOOTSTRAP_PASSWORD="$BOOT_PW" \
  "$ROOT/infra/docker/postgres/apply-roles.sh" dream-test-postgres test >/dev/null && code=0 || code=$?
check "apply-roles on the existing database exits 0 (exit $code)" test "$code" = 0
check "every object in public now owned by dp_owner" test "$(not_owned_by_dp_owner)" = 0
check "data, migration history and triggers unchanged by apply-roles" test "$(fingerprint)" = "$fp_before"

if test_compose up -d --wait --no-build api >/dev/null 2>&1; then ok "up api succeeded after apply-roles"; else bad "up api failed after apply-roles"; fi
check "runner applied ADR-012A and every later migration ($legacy_count -> $(applied), +$later_count)" test "$(applied)" = $((legacy_count + later_count))
check "it was the ADR-012A migration" \
  test "$(sql "select count(*) from _prisma_migrations where migration_name = '$G0_MIGRATION' and finished_at is not null;")" = 1
fp_after="$(fingerprint)"
check "user and audit rows unchanged by the upgrade" test "$(head -2 <<<"$fp_after")" = "$(head -2 <<<"$fp_before")"
check "legacy audit events stay in the STANDARD stream without a chain (DP-108)" \
  test "$(sql "select count(*) from \"AuditEvent\" where stream <> 'STANDARD' or \"chainSeq\" is not null;")" = 0
check "still every object owned by dp_owner" test "$(not_owned_by_dp_owner)" = 0
ready="$(ready_json)"
check "API ready as dp_app on the upgraded database ($ready)" grep -q '^200 .*env=test db=dream_platform_test' <<<"$ready"
check "upgraded grants equal a new database's grants" \
  test "$(role_state | grep -E '^(grant|setting|member|role)' )" = "$(grep -E '^(grant|setting|member|role)' <<<"$after")"
check "append-only still enforced for the owner (trigger)" \
  bash -c 'out="$(docker exec -i dream-test-postgres psql -X -q -At -U dream_platform_test -d dream_platform_test -c "set role dp_owner; delete from \"AuditEvent\";" 2>&1)"; grep -q "append-only" <<<"$out"'
check "dp_app cannot delete audit rows (privilege)" \
  bash -c 'out="$(docker exec -i dream-test-postgres psql -X -q -At -U dream_platform_test -d dream_platform_test -c "set role dp_app; delete from \"AuditEvent\";" 2>&1)"; grep -q "permission denied" <<<"$out"'

echo
echo "Result: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
