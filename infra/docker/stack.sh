#!/usr/bin/env bash
# Start, stop and reset the local platform stack. Needs only Docker and bash: no host Node/pnpm.
#
#   infra/docker/stack.sh dev  up [svc...]|down|ps|logs [svc]|restart [svc]
#   infra/docker/stack.sh prod up|down|ps|logs [svc]
#   infra/docker/stack.sh dev  reset --yes       # dev caches only (node_modules, .next, dist)
#   infra/docker/stack.sh dev  tls-ca            # DP-119: export the DEV HTTPS root (Safari)
#   infra/docker/stack.sh      reset-db dev|prod --yes [--dry-run]  # that mode's Postgres volume only
#   infra/docker/stack.sh      migrate dev|prod  # prisma migrate dev | deploy in the running mode
#   infra/docker/stack.sh      db-roles dev|prod --yes   # ADR-012A roles on an EXISTING database
#   infra/docker/stack.sh      iam sync dev|prod         # mirror the IAM catalogue (dp_migrator)
#   infra/docker/stack.sh      iam bootstrap dev|prod --email <e> [--name <n>]  # dp_iam_bootstrap
#   infra/docker/stack.sh      iam enrol-link|reset-link dev|prod --email <e>     # dp_app, link once
#   infra/docker/stack.sh      iam recover-admin dev|prod --email <e> --reason <t> # dp_app, last resort
#   infra/docker/stack.sh      iam cleanup dev|prod                               # dp_app
#   infra/docker/stack.sh      iam owner-designate|owner-recover dev|prod --email <e> --reason <t>  # DP-108
#   infra/docker/stack.sh      iam owner-status dev|prod                         # dp_iam_bootstrap
#   infra/docker/stack.sh      leads retention|erase|hold dev|prod [args] [--apply] # DP-096, dry run default
#   infra/docker/stack.sh      media cleanup dev|prod [--grace-hours <n>] [--apply] # orphan files (PM-3)
#   infra/docker/stack.sh      preflight dev|prod
#   infra/docker/stack.sh      smoke             # HTTP smoke test in a throwaway container
#   infra/docker/stack.sh      budget [dev|prod] # memory/CPU budget vs. free memory in the VM
#   infra/docker/stack.sh      check             # quality gate build (docker build --target check)
#   infra/docker/stack.sh      test unit|integration|migrations|roles   # test suites (ADR-010)
#
# dev = compose.yaml + compose.dev.yaml (hot reload); prod = compose.yaml (production builds).
# Both use the Compose project "dream-petroleum-platform" and the same ports, so they are
# mutually exclusive. `up` fails fast if the other mode is running or a port is taken.
# `up` and `check` are heavy jobs: they run one at a time (lock) and fail fast unless the Docker
# VM keeps a reserve plus a safety margin free for other projects after the job's estimated peak
# (lib.sh, resource-policy.mjs).
# Each mode has its own Postgres volume, database and user (ADR-009). Nothing here removes data
# unless a reset command is given together with --yes, and every removal is limited to this
# project's own containers and volumes.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
ENV_FILE="$ROOT/.env"
PORTS=(3110 3111 3112 3113 3114 5440)
# shellcheck source=lib.sh
source "$DIR/lib.sh"

compose_args() { # prints nothing; fills COMPOSE_ARGS for a mode
  local mode="$1"
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE missing. Run: cp .env.example .env (then set a local password)"
  COMPOSE_ARGS=(-p "$PROJECT" -f "$DIR/compose.yaml")
  [[ "$mode" == dev ]] && COMPOSE_ARGS+=(-f "$DIR/compose.dev.yaml")
  COMPOSE_ARGS+=(--env-file "$ENV_FILE")
}

compose() {
  local mode="$1"; shift
  compose_args "$mode"
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

# Mode of each running container of this project: "dev" if it was created with the dev overlay.
running_modes() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Names}}|{{.Label "com.docker.compose.project.config_files"}}' |
    while IFS='|' read -r name files; do
      [[ -z "$name" ]] && continue
      if [[ "$files" == *compose.dev.yaml* ]]; then echo "dev $name"; else echo "prod $name"; fi
    done
}

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

preflight() {
  local mode="$1" other failed=0
  [[ "$mode" == dev ]] && other=prod || other=dev

  local clash
  clash="$(running_modes | awk -v o="$other" '$1==o {print $2}')"
  if [[ -n "$clash" ]]; then
    echo "FAIL: the $other stack is running ($(echo $clash | tr '\n' ' '))." >&2
    echo "      Stop it first: infra/docker/stack.sh $other down" >&2
    failed=1
  fi

  # Containers named dream-platform-* that belong to another Compose project.
  local foreign
  foreign="$(docker ps -a --filter 'name=^/dream-platform-' \
    --format '{{.Names}}|{{.Label "com.docker.compose.project"}}' | awk -F'|' -v p="$PROJECT" '$2!=p {print $1}')"
  if [[ -n "$foreign" ]]; then
    echo "FAIL: container name(s) used by another project: $foreign" >&2
    failed=1
  fi

  local port owner
  for port in "${PORTS[@]}"; do
    owner="$(docker ps --filter "publish=$port" --format '{{.Names}}|{{.Label "com.docker.compose.project"}}' | head -1)"
    if [[ -n "$owner" ]]; then
      if [[ "${owner#*|}" != "$PROJECT" ]]; then
        echo "FAIL: port $port is published by container ${owner%%|*} (another Compose project or none)" >&2
        failed=1
      fi
    elif port_open "$port"; then
      echo "FAIL: port $port is taken by a host process" >&2
      failed=1
    fi
  done

  (( failed == 0 )) || die "preflight for '$mode' failed; nothing was started"
  info "preflight $mode: no conflicts on ${PORTS[*]}"
}

# Volumes of this project created by the dev overlay (names ..._dev-*). Never Postgres data.
# Base of the links the operator commands print. DEV may use the HTTPS proxy (DP-119) once its
# CA is trusted: DEV_DP_ADMIN_BASE_URL in .env, the same value the DEV API uses.
admin_base_url() {
  local v=""
  [[ "$1" == dev ]] && v="$(env_value DEV_DP_ADMIN_BASE_URL)"
  echo "${v:-http://admin.localhost:3112}"
}

dev_volumes() {
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -E "^${PROJECT}_dev-" || true
}

require_yes() { [[ " $* " == *" --yes "* ]] || die "this deletes data; repeat with --yes"; }

# Postgres data volume of each mode (ADR-009). The only place the mapping is written down
# outside the Compose files; tools/dev/db-isolation-test.sh checks both agree.
db_volume_key() {
  case "$1" in
    dev) echo "postgres-data-dev" ;;
    prod) echo "postgres-data" ;;
    *) die "mode must be dev or prod" ;;
  esac
}

env_value() { # KEY -> value from .env (no shell evaluation of the file)
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$ENV_FILE"
}

# Dev and prod must not share a database identity, or the API guard could not tell them apart.
# ADR-012A: every separated role has its own password per mode, at least 16 characters, different
# from the other roles of that mode and from the same role in the other mode.
check_db_identity() {
  local d p k a b
  for k in DB USER PASSWORD; do
    d="$(env_value "DEV_POSTGRES_$k")"; p="$(env_value "POSTGRES_$k")"
    [[ -n "$d" && -n "$p" ]] || die "POSTGRES_$k and DEV_POSTGRES_$k must both be set in .env (see .env.example)"
    [[ "$k" == PASSWORD || "$d" != "$p" ]] || die "DEV_POSTGRES_$k must differ from POSTGRES_$k (ADR-009)"
  done
  for k in DP_APP_PASSWORD DP_MIGRATOR_PASSWORD DP_IAM_BOOTSTRAP_PASSWORD; do
    d="$(env_value "DEV_$k")"; p="$(env_value "$k")"
    [[ ${#d} -ge 16 && ${#p} -ge 16 ]] ||
      die "$k and DEV_$k must be set in .env with at least 16 characters (ADR-012A, see .env.example)"
    [[ "$d" != "$p" ]] || die "DEV_$k must differ from $k (ADR-009, ADR-012A)"
    # They are embedded in connection URLs, so only URL-unreserved characters are allowed.
    [[ "$d" =~ ^[A-Za-z0-9._~-]+$ && "$p" =~ ^[A-Za-z0-9._~-]+$ ]] ||
      die "$k and DEV_$k may only use A-Z a-z 0-9 . _ ~ - (they are embedded in database URLs)"
  done
  for k in "" DEV_; do
    a="$(env_value "${k}DP_APP_PASSWORD")"; b="$(env_value "${k}DP_MIGRATOR_PASSWORD")"
    p="$(env_value "${k}DP_IAM_BOOTSTRAP_PASSWORD")"
    [[ "$a" != "$b" && "$a" != "$p" && "$b" != "$p" ]] ||
      die "${k}DP_APP_PASSWORD, ${k}DP_MIGRATOR_PASSWORD and ${k}DP_IAM_BOOTSTRAP_PASSWORD must all differ (ADR-012A)"
  done
}

# F1-002 Group 2 (ADR-013 D2, D19): the proxy keys and IAM secrets of each mode. The API checks
# length and distinctness itself and refuses to start; this check only gives a clear message
# before anything is built, and enforces that dev and prod never share a value.
AUTH_SECRET_KEYS=(DP_PROXY_KEY_ADMIN DP_PROXY_KEY_WEB_BV DP_PROXY_KEY_WEB_CORPORATE IAM_MFA_ENC_KEYS IAM_HMAC_KEY)
check_auth_secrets() {
  local mode="$1" prefix k v other
  prefix="$(mode_prefix "$mode")"
  for k in "${AUTH_SECRET_KEYS[@]}"; do
    v="$(env_value "${prefix}$k")"
    [[ -n "$v" ]] || die "${prefix}$k is not set in .env (F1-002: generate it as in .env.example; the API does not start without it)"
    if [[ "$mode" == dev ]]; then other="$(env_value "$k")"; else other="$(env_value "DEV_$k")"; fi
    [[ "$v" != "$other" ]] || die "${prefix}$k must differ between dev and prod (one key per environment)"
  done
}

# .env key prefix of a mode's role passwords and database name.
mode_prefix() { [[ "$1" == dev ]] && echo "DEV_" || echo ""; }

# The running stack must be exactly this mode, and its Postgres must serve this mode's database.
require_running_mode() {
  local mode="$1" running
  running="$(running_modes | awk '{print $1}' | sort -u)"
  [[ "$running" == "$mode" ]] || die "the $mode stack is not running (running: ${running:-none}); nothing changed"
  local label
  label="$(docker inspect -f '{{index .Config.Labels "com.dream-petroleum.platform.db-env"}}' dream-platform-postgres 2>/dev/null)" ||
    die "dream-platform-postgres is not running; start it with: infra/docker/stack.sh $mode up postgres"
  [[ "$label" == "$mode" ]] || die "dream-platform-postgres serves '$label', not '$mode'; nothing changed"
}

smoke() {
  mkdir -p "$ROOT/tools/smoke/output"
  # Ports are bound to 127.0.0.1. Docker Desktop reaches them via host.docker.internal; on a
  # Linux engine (CI runners) only the host network namespace can.
  local net=(-e SMOKE_HOST=host.docker.internal)
  if [[ "$(docker info -f '{{.OperatingSystem}}')" != *"Docker Desktop"* ]]; then
    net=(--network host -e SMOKE_HOST=127.0.0.1)
  fi
  docker run --rm --label "com.dream-petroleum.platform=smoke" --memory 256m --memory-swap 256m \
    "${net[@]}" -e SMOKE_TIMEOUT_MS="${SMOKE_TIMEOUT_MS:-120000}" \
    -v "$ROOT:/repo:ro" -v "$ROOT/tools/smoke/output:/repo/tools/smoke/output" \
    "$NODE_IMAGE" node /repo/tools/smoke/smoke.mjs --report /repo/tools/smoke/output/smoke.json
}

cmd_mode() {
  local mode="$1" action="${2:-}"; shift 2 || true
  case "$action" in
    up)
      acquire_heavy_lock "$mode up"
      check_db_identity
      check_auth_secrets "$mode"
      preflight "$mode"
      # Image build budget: the dev image is only the toolchain; prod builds every app.
      local build_mb=512
      [[ "$mode" == prod ]] && build_mb="$BUILD_BUDGET_MB"
      compose_args "$mode"
      # `up <service>...` starts those services and their dependencies; budget exactly that.
      local known arg
      known=" $(docker compose "${COMPOSE_ARGS[@]}" config --services | tr '\n' ' ') "
      PLAN_SERVICES=()
      for arg in "$@"; do
        if [[ "$known" == *" $arg "* ]]; then PLAN_SERVICES+=("$arg"); fi
      done
      resource_check "$mode" $(( build_mb * MiB )) "${COMPOSE_ARGS[@]}" ||
        die "resource preflight for '$mode' failed; nothing was started"
      compose "$mode" up -d --build --wait --wait-timeout 300 "$@"
      compose "$mode" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' ;;
    down) compose "$mode" down "$@" ;;          # keeps every volume
    ps) compose "$mode" ps -a --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' ;;
    logs) compose "$mode" logs --tail 100 "$@" ;;
    restart) compose "$mode" restart "$@" ;;
    reset)
      [[ "$mode" == dev ]] || die "reset applies to dev caches only"
      require_yes "$@"
      compose dev down --remove-orphans
      local vols; vols="$(dev_volumes)"
      if [[ -n "$vols" ]]; then
        info "removing dev volumes:"; echo "$vols" >&2
        echo "$vols" | xargs docker volume rm >/dev/null
      fi
      info "dev caches removed; Postgres data kept" ;;
    tls-ca)
      # DP-119: copy the root certificate of the DEV HTTPS proxy (Caddy's local CA) out of its
      # volume. Only the public certificate; the CA key never leaves the volume. Trusting it is
      # the owner's step on the Mac (a Keychain change), so the command is printed, not run.
      [[ "$mode" == dev ]] || die "tls-ca applies to dev only"
      local out="$HOME/.dream-petroleum-platform/dev-tls"
      mkdir -p "$out"
      docker cp dream-platform-admin-tls:/data/caddy/pki/authorities/local/root.crt "$out/root.crt" >/dev/null ||
        die "the DEV HTTPS proxy is not running or has not created its CA yet (dev up first)"
      info "DEV HTTPS root certificate: $out/root.crt"
      openssl x509 -in "$out/root.crt" -noout -subject -enddate -fingerprint -sha256 >&2 2>/dev/null || true
      cat >&2 <<EOT
Trust it for this user (asks for your macOS password; reversible in Keychain Access):
  security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db "$out/root.crt"
Then open https://admin.localhost:3114 (Safari, Chrome, Firefox with system roots).
Optional: DEV_DP_ADMIN_BASE_URL=https://admin.localhost:3114 in .env makes invitation and
recovery links use it (then: dev up).
EOT
      ;;
    *) die "unknown action '$action' for $mode" ;;
  esac
}

case "${1:-}" in
  dev|prod) cmd_mode "$@" ;;
  preflight) preflight "${2:?preflight dev|prod}" ;;
  smoke) smoke ;;
  budget)
    mode="${2:-}"
    if [[ -z "$mode" ]]; then # the mode that is running, else dev
      mode="$(running_modes | awk 'NR==1 {print $1}')"; mode="${mode:-dev}"
    fi
    [[ "$mode" == dev || "$mode" == prod ]] || die "budget dev|prod"
    compose_args "$mode"
    resource_check report 0 "${COMPOSE_ARGS[@]}"
    echo "Heavy one-off jobs: toolbox $TOOLBOX_MEM (hard limit, ${TOOLBOX_CPUS} cpus, heap ${TOOLBOX_HEAP_MB} MiB), check/prod image build ${BUILD_BUDGET_MB} MiB (budgeted)" ;;
  check)
    acquire_heavy_lock "check build"
    resource_check heavy:check-build $(( BUILD_BUDGET_MB * MiB )) ||
      die "resource preflight for the check build failed; nothing was started"
    # cacheonly: run the gate without exporting an (untagged, ~2 GB) image
    docker build --target check --output type=cacheonly -f "$DIR/Dockerfile" "$ROOT" ;;
  reset-db)
    # reset-db <dev|prod> --yes [--dry-run]. Removes exactly one volume: the named mode's
    # Postgres data, after checking its Compose labels. Never both, never by pattern.
    mode="${2:-}"
    [[ "$mode" == dev || "$mode" == prod ]] ||
      die "a mode is required: reset-db dev --yes | reset-db prod --yes (nothing removed)"
    shift 2
    dry=0
    for arg in "$@"; do
      case "$arg" in
        --yes) ;;
        --dry-run) dry=1 ;;
        *) die "unknown argument '$arg' (nothing removed)" ;;
      esac
    done
    require_yes "$@"
    [[ -z "$(running_modes)" ]] || die "stop the stack first (dev down / prod down); nothing removed"
    key="$(db_volume_key "$mode")"
    vol="${PROJECT}_${key}"
    if ! docker volume inspect "$vol" >/dev/null 2>&1; then
      info "$vol does not exist; nothing to remove"; exit 0
    fi
    labels="$(docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' "$vol")"
    [[ "$labels" == "$PROJECT|$key" ]] ||
      die "$vol is not this project's '$key' volume (labels: $labels); nothing removed"
    users="$(docker ps -a --filter "volume=$vol" --format '{{.Names}}')"
    [[ -z "$users" ]] || die "$vol is used by container(s): $users; nothing removed"
    if (( dry )); then
      info "dry run: would remove $vol ($mode database); nothing removed"; exit 0
    fi
    docker volume rm "$vol" >/dev/null && info "removed $vol ($mode database)" ;;
  test)
    # Tests never touch the dev or local-prod databases: unit tests use none, integration and
    # migration tests use the disposable test project (compose.test.yaml).
    case "${2:-}" in
      unit) "$ROOT/infra/docker/toolbox.sh" 'pnpm install --frozen-lockfile >/dev/null && pnpm turbo run test' ;;
      integration) exec "$ROOT/tools/test/integration-test.sh" ;;
      migrations) exec "$ROOT/tools/test/migration-safety-test.sh" ;;
      roles) exec "$ROOT/tools/test/db-roles-test.sh" ;;
      *) die "test unit|integration|migrations|roles" ;;
    esac ;;
  migrate)
    # Runs only in the mode that is running, in a one-shot container of that mode's `migrate`
    # service, so it connects as dp_migrator (ADR-012A). The API's dp_app role cannot run DDL.
    mode="${2:-}"
    [[ "$mode" == dev || "$mode" == prod ]] || die "migrate dev|prod"
    shift 2
    require_running_mode "$mode"
    if [[ "$mode" == dev ]]; then
      compose dev run --rm --no-deps migrate node_modules/.bin/prisma migrate dev "$@"  # creates + applies
    else
      compose prod run --rm --no-deps migrate node_modules/.bin/prisma migrate deploy "$@"  # applies committed only
    fi ;;
  db-roles)
    # ADR-012A on a database whose data directory already existed (the init script runs only on
    # an empty one): creates the roles, sets their passwords, transfers ownership of every object
    # in schema public to dp_owner and restricts database access. Idempotent; changes no rows.
    # Take a pg_dump first. The table grants follow with the next migrate (migration
    # 20261110230000_adr_012a_database_roles).
    mode="${2:-}"
    [[ "$mode" == dev || "$mode" == prod ]] || die "db-roles dev|prod --yes"
    shift 2
    require_yes "$@"
    check_db_identity
    require_running_mode "$mode"
    prefix="$(mode_prefix "$mode")"
    DP_APP_PASSWORD="$(env_value "${prefix}DP_APP_PASSWORD")"
    DP_MIGRATOR_PASSWORD="$(env_value "${prefix}DP_MIGRATOR_PASSWORD")"
    DP_IAM_BOOTSTRAP_PASSWORD="$(env_value "${prefix}DP_IAM_BOOTSTRAP_PASSWORD")"
    export DP_APP_PASSWORD DP_MIGRATOR_PASSWORD DP_IAM_BOOTSTRAP_PASSWORD
    "$DIR/postgres/apply-roles.sh" dream-platform-postgres "$mode"
    info "roles in place on the $mode database; next: infra/docker/stack.sh migrate $mode (as dp_migrator)" ;;
  iam)
    # iam sync|bootstrap <dev|prod> [args]: the IAM CLI in a one-shot container of the mode's
    # `migrate` service. Each command gets only its own credential (ADR-012A, ADR-013 D14):
    # sync the migrator URL, bootstrap the dp_iam_bootstrap URL (never given to the API).
    sub="${2:-}"; mode="${3:-}"
    case "$sub" in
      sync | bootstrap | enrol-link | reset-link | recover-admin | cleanup) ;;
      owner-designate | owner-recover | owner-status) ;;
      *) die "iam sync|bootstrap|enrol-link|reset-link|recover-admin|cleanup|owner-designate|owner-recover|owner-status dev|prod [args]" ;;
    esac
    [[ "$mode" == dev || "$mode" == prod ]] || die "iam $sub dev|prod"
    shift 3
    check_db_identity
    require_running_mode "$mode"
    prefix="$(mode_prefix "$mode")"
    if [[ "$mode" == dev ]]; then db="$(env_value DEV_POSTGRES_DB)"; else db="$(env_value POSTGRES_DB)"; fi
    if [[ "$sub" == sync ]]; then
      compose "$mode" run --rm --no-deps -T migrate node dist/iam/iam-cli.js sync --confirm-database "$db"
    elif [[ "$sub" == owner-* ]]; then
      # DP-108 (ADR-018): the system owner's designation and recovery run only with the operator
      # credential dp_iam_bootstrap, never with the API's dp_app (condition 1). Links are printed
      # once to this terminal.
      IAM_BOOTSTRAP_DATABASE_URL="postgresql://dp_iam_bootstrap:$(env_value "${prefix}DP_IAM_BOOTSTRAP_PASSWORD")@postgres:5432/${db}?schema=public"
      DP_ADMIN_BASE_URL="$(admin_base_url "$mode")" # local admin host (design 2.8, DP-119)
      export IAM_BOOTSTRAP_DATABASE_URL DP_ADMIN_BASE_URL
      compose "$mode" run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e DATABASE_URL= \
        -e IAM_BOOTSTRAP_DATABASE_URL -e DP_ADMIN_BASE_URL \
        migrate node dist/iam/iam-cli.js "$sub" --confirm-database "$db" "$@"
    elif [[ "$sub" != bootstrap ]]; then
      # F1-002 Group 2: links, recovery and clean-up run as dp_app (the API's role) with only that
      # credential; a link is printed once to this terminal and never logged.
      DATABASE_URL="postgresql://dp_app:$(env_value "${prefix}DP_APP_PASSWORD")@postgres:5432/${db}?schema=public"
      DP_ADMIN_BASE_URL="$(admin_base_url "$mode")" # local admin host (design 2.8, DP-119)
      export DATABASE_URL DP_ADMIN_BASE_URL
      compose "$mode" run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e DATABASE_URL -e DP_ADMIN_BASE_URL \
        migrate node dist/iam/iam-cli.js "$sub" --confirm-database "$db" "$@"
    else
      IAM_BOOTSTRAP_DATABASE_URL="postgresql://dp_iam_bootstrap:$(env_value "${prefix}DP_IAM_BOOTSTRAP_PASSWORD")@postgres:5432/${db}?schema=public"
      export IAM_BOOTSTRAP_DATABASE_URL
      # The migrator URL is blanked in this container: it holds only the bootstrap credential.
      compose "$mode" run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e IAM_BOOTSTRAP_DATABASE_URL \
        migrate node dist/iam/iam-cli.js bootstrap --confirm-database "$db" "$@"
    fi ;;
  leads)
    # leads retention|erase|hold <dev|prod> [args] (DP-096, ADR-003 §5): lead retention run (dry
    # run unless --apply), erasure on request (dry run unless --apply) and retention holds. Runs
    # with the operator credential dp_iam_bootstrap only, which switches to the least-privilege
    # role dp_lead_retention; the API's credential is not passed in. Output: counts only.
    sub="${2:-}"; mode="${3:-}"
    case "$sub" in
      retention | erase | hold) ;;
      *) die "leads retention|erase|hold dev|prod [args] (see apps/api/src/leads/leads-cli.ts)" ;;
    esac
    [[ "$mode" == dev || "$mode" == prod ]] || die "leads $sub dev|prod"
    shift 3
    check_db_identity
    require_running_mode "$mode"
    prefix="$(mode_prefix "$mode")"
    if [[ "$mode" == dev ]]; then db="$(env_value DEV_POSTGRES_DB)"; else db="$(env_value POSTGRES_DB)"; fi
    IAM_BOOTSTRAP_DATABASE_URL="postgresql://dp_iam_bootstrap:$(env_value "${prefix}DP_IAM_BOOTSTRAP_PASSWORD")@postgres:5432/${db}?schema=public"
    export IAM_BOOTSTRAP_DATABASE_URL
    compose "$mode" run --rm --no-deps -T -e MIGRATE_DATABASE_URL= -e DATABASE_URL= \
      -e IAM_BOOTSTRAP_DATABASE_URL \
      migrate node dist/leads/leads-cli.js "$sub" --confirm-database "$db" "$@" ;;
  media)
    # media cleanup <dev|prod> [--grace-hours n] [--apply]: orphaned media files (PM-3). Runs in
    # the running API container, which holds the storage configuration, the media volume and its
    # own dp_app credential; nothing else is passed in. Dry run unless --apply.
    sub="${2:-}"; mode="${3:-}"
    [[ "$sub" == cleanup ]] || die "media cleanup dev|prod [--grace-hours <n>] [--apply]"
    [[ "$mode" == dev || "$mode" == prod ]] || die "media cleanup dev|prod"
    shift 3
    require_running_mode "$mode"
    if [[ "$mode" == dev ]]; then db="$(env_value DEV_POSTGRES_DB)"; else db="$(env_value POSTGRES_DB)"; fi
    compose "$mode" exec -T api node dist/media/media-cli.js cleanup --confirm-database "$db" "$@" ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac
