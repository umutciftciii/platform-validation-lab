# shellcheck shell=bash
# Local production mode (DP-277, ADR-029): image promotion, backups, sync from origin/main,
# rollback and the controlled dev <-> local switch. Sourced by stack.sh, not executed; uses its
# helpers (compose, preflight, running_modes, smoke, acquire_heavy_lock, resource_check, ...).
# bash 3.2 compatible (macOS /bin/bash): no mapfile, no associative arrays, no `wait -n`.
#
# Images: dream-petroleum-platform-local:<sha12> (one per built origin/main commit), :current (what
# `local up` runs) and :previous (the image :current replaced; target of `local rollback`).
# Backups: one directory per backup under DP_BACKUP_DIR (default: ../dream-petroleum-backups next
# to the repo), mode 700: pg_dump -Fc, roles without passwords, the applied migrations, a tar of
# the media volume, SHA256SUMS and a manifest. Nothing here restores, removes or prunes data.

# DP_LOCAL_IMAGE_REPO is read by compose.local.yaml too; only the isolated fixture overrides it.
LOCAL_REPO="${DP_LOCAL_IMAGE_REPO:-dream-petroleum-platform-local}"
export DP_LOCAL_IMAGE_REPO="$LOCAL_REPO"
# Temporary archive of sync-main; global so the EXIT trap still sees it after the function returns
# (with `set -u` a function-local name would be unbound there and the trap would fail).
SYNC_WORK=""
LOCAL_STATE_DIR="${DP_LOCAL_STATE_DIR:-$HOME/.dream-petroleum-platform/local}"
BACKUP_ROOT="${DP_BACKUP_DIR:-$(cd "$ROOT/.." && pwd)/dream-petroleum-backups}"
PG_CONTAINER="$CONTAINER_PREFIX-postgres"
PG_IMAGE="postgres:17.11-alpine"
DEV_MEDIA_VOLUME="${PROJECT}_dev-media"
# Services the local mode recreates on a promotion; postgres and admin-tls keep running.
LOCAL_APP_SERVICES=(migrate api web-bv web-corporate admin)
# Services stopped on a safe stop: everything that serves requests. Postgres stays up (data intact,
# inspectable); nothing is removed.
LOCAL_SERVING_SERVICES=(admin-tls admin web-bv web-corporate api)

image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
image_sha() { docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null || true; }
utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }
sha256_tool() { if command -v sha256sum >/dev/null; then echo sha256sum; else echo "shasum -a 256"; fi; }

log_history() { # one line per promotion/rollback; no secrets
  mkdir -p "$LOCAL_STATE_DIR"
  printf '%s %s\n' "$(utc_stamp)" "$*" >>"$LOCAL_STATE_DIR/history.log"
}

# Volumes a mode attaches that another mode also uses (dev and local share the DEV data).
shared_volumes() { echo "${PROJECT}_postgres-data-dev $DEV_MEDIA_VOLUME ${PROJECT}_tls-ca-dev ${PROJECT}_tls-config-dev"; }

# ADR-029 D3: a DEV data volume is never attached to containers of two modes. Fails if any
# container (running or stopped, any project) that is not a container of `mode` in this project
# has one of the shared volumes. `dev down` / `local down` remove a mode's containers.
assert_volumes_free_for() {
  local mode="$1" vol name files project bad=""
  for vol in $(shared_volumes); do
    while IFS='|' read -r name project files; do
      [[ -z "$name" ]] && continue
      if [[ "$project" != "$PROJECT" ]]; then
        bad="$bad $name($vol, project ${project:-none})"
      elif [[ "$(mode_of_files "$files")" != "$mode" ]]; then
        bad="$bad $name($vol, $(mode_of_files "$files") mode)"
      fi
    done < <(docker ps -a --filter "volume=$vol" \
      --format '{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.config_files"}}')
  done
  [[ -z "$bad" ]] || die "DEV data volume(s) attached to other containers:$bad. Stop that mode first (stack.sh <mode> down); nothing was started (ADR-029 D3)"
}

require_local_image() {
  local tag="$1"
  [[ -n "$(image_id "$LOCAL_REPO:$tag")" ]] ||
    die "$LOCAL_REPO:$tag does not exist; first install: infra/docker/stack.sh sync-main --bootstrap (then switch local --yes); otherwise: infra/docker/stack.sh sync-main"
}

pg_running_dev() { # the running Postgres container serves the DEV database
  [[ "$(docker inspect -f '{{.State.Running}}|{{index .Config.Labels "com.dream-petroleum.platform.db-env"}}' "$PG_CONTAINER" 2>/dev/null)" == "true|dev" ]]
}

# Applied migrations of the DEV database (sorted names; none on an empty database), as the
# superuser over the container's local socket. Credentials come from the container's own
# environment, never a command line. Fails if the database cannot be read.
applied_migrations() {
  docker exec "$PG_CONTAINER" sh -c '
    q() { psql -X -q -tA -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"; }
    t="$(q "SELECT to_regclass(\$\$public._prisma_migrations\$\$) IS NOT NULL")" || exit 1
    [ "$t" = t ] || exit 0
    q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"' |
    sed '/^$/d' | LC_ALL=C sort
}

# Migrations committed in an image (directory names), sorted. Fails if none can be listed.
image_migrations() {
  docker run --rm --network none --memory 128m --memory-swap 128m --entrypoint sh "$1" -c \
    'cd /repo/apps/api/prisma/migrations && for d in */; do echo "${d%/}"; done' | LC_ALL=C sort
}

# migration_diff <image> pending|unknown. pending: committed in the image, not applied yet.
# unknown: applied in the database but missing from the image (the image is older than the data).
# Fails (non-zero, nothing printed) if either list cannot be read.
migration_diff() {
  local img applied
  img="$(image_migrations "$1")" || { echo "error: could not list the migrations of $1" >&2; return 1; }
  [[ -n "$img" ]] || { echo "error: $1 contains no migrations" >&2; return 1; }
  applied="$(applied_migrations)" || { echo "error: could not read the applied migrations of the DEV database" >&2; return 1; }
  if [[ "$2" == pending ]]; then
    LC_ALL=C comm -23 <(printf '%s\n' "$img") <(printf '%s\n' "$applied") | sed '/^$/d'
  else
    LC_ALL=C comm -13 <(printf '%s\n' "$img") <(printf '%s\n' "$applied") | sed '/^$/d'
  fi
}

# backup_dev_data <label>: consistent backup of the DEV database and media while Postgres runs.
# Prints the backup directory on stdout. Fails (and leaves the partial directory for inspection)
# if any part is empty or unreadable.
backup_dev_data() {
  local label="$1" dir n_media sum
  pg_running_dev || die "the DEV database is not running in $PG_CONTAINER; no backup taken"
  mkdir -p "$BACKUP_ROOT"
  dir="$BACKUP_ROOT/LOCAL-$(utc_stamp)-$label"
  mkdir -m 700 "$dir" || die "could not create $dir"
  info "backup: $dir"
  docker exec "$PG_CONTAINER" sh -c 'pg_dump --no-password -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$dir/db.dump" ||
    die "pg_dump failed; see $dir"
  docker exec "$PG_CONTAINER" sh -c 'pg_dumpall --no-password -U "$POSTGRES_USER" --globals-only --no-role-passwords' >"$dir/roles.sql" ||
    die "pg_dumpall --globals-only failed; see $dir"
  applied_migrations >"$dir/migrations.txt" || die "could not read the applied migrations; see $dir"
  # The dump must be a readable archive with table data.
  docker exec -i "$PG_CONTAINER" pg_restore -l <"$dir/db.dump" >"$dir/db.toc" ||
    die "the dump is not a readable archive; see $dir"
  grep -q 'TABLE DATA' "$dir/db.toc" || die "the dump has no table data; see $dir"
  # Media: read-only mount of the volume in a throwaway container without network.
  docker run --rm --network none --memory 128m --memory-swap 128m \
    --label "com.dream-petroleum.platform=backup" \
    -v "$DEV_MEDIA_VOLUME:/media:ro" "$PG_IMAGE" tar -C /media -cf - . >"$dir/media.tar" ||
    die "media backup failed; see $dir"
  n_media="$(tar -tf "$dir/media.tar" | grep -vc '/$' || true)"
  sum="$(sha256_tool)"
  (cd "$dir" && $sum db.dump roles.sql migrations.txt media.tar >SHA256SUMS)
  {
    echo "label: $label"
    echo "created: $(utc_stamp)"
    echo "database: DEV (volume ${PROJECT}_postgres-data-dev), pg_dump -Fc, $(wc -c <"$dir/db.dump" | tr -d ' ') bytes"
    echo "applied migrations: $(wc -l <"$dir/migrations.txt" | tr -d ' ')"
    echo "media: volume $DEV_MEDIA_VOLUME, $n_media files, $(wc -c <"$dir/media.tar" | tr -d ' ') bytes"
    echo "running image: $(image_sha "$LOCAL_REPO:current")"
    echo "restore: owner decision only (ADR-029 D6); see docs/adr/ADR-029-local-production-mode.md"
  } >"$dir/MANIFEST.txt"
  chmod 600 "$dir"/*
  info "backup complete: $(wc -l <"$dir/migrations.txt" | tr -d ' ') migrations, $n_media media files"
  echo "$dir"
}

# Starts Postgres of the local mode alone (no-op if it already runs).
local_postgres_up() {
  compose local up -d --no-build --pull never --wait --wait-timeout 120 postgres >&2
}

# The serving check after a start: every service healthy (compose --wait), then the smoke test
# (health, /health/ready on the DEV database, auth boundary, BV routes, media, admin-tls). The
# smoke test writes nothing. SMOKE_ROOT selects the smoke tool of the commit being deployed.
local_verify() {
  local root="${1:-$ROOT}"
  SMOKE_ROOT="$root" smoke
}

# Safe stop: the serving services stop (containers kept, nothing removed); Postgres keeps the data.
local_safe_stop() {
  local reason="$1" backup="${2:-}"
  compose local stop "${LOCAL_SERVING_SERVICES[@]}" >&2 || true
  log_history "safe-stop $reason backup=${backup:-none}"
  echo "SAFE STOP: $reason" >&2
  echo "  The serving services are stopped; Postgres keeps running with the data as it is now." >&2
  [[ -n "$backup" ]] && echo "  Backup taken before this attempt: $backup" >&2
  echo "  Nothing was restored or removed. Restoring a backup is an owner decision (ADR-029 D6)." >&2
}

# local_up [service...]: start the promoted image (:current). Backs up first when the image has
# migrations the database has not applied yet (the migrate service would apply them). Every step
# fails explicitly, so it is safe to call where `set -e` does not apply.
local_up() {
  local tag="${DP_LOCAL_TAG:-current}" pending backup=""
  acquire_heavy_lock "local up"
  check_db_identity
  check_auth_secrets local
  preflight local
  assert_volumes_free_for local
  require_local_image "$tag"
  [[ -n "$(image_id "$PG_IMAGE")" ]] || die "$PG_IMAGE is missing locally (never pulled implicitly)"
  [[ -n "$(image_id caddy:2.11.6-alpine)" ]] || die "caddy:2.11.6-alpine is missing locally (never pulled implicitly)"
  compose_args local
  local known arg
  known=" $(docker compose "${COMPOSE_ARGS[@]}" config --services | tr '\n' ' ') "
  PLAN_SERVICES=()
  for arg in "$@"; do
    if [[ "$known" == *" $arg "* ]]; then PLAN_SERVICES+=("$arg"); fi
  done
  resource_check local 0 "${COMPOSE_ARGS[@]}" ||
    die "resource preflight for 'local' failed; nothing was started"
  local_postgres_up || die "Postgres of the local mode did not become healthy"
  local unknown
  unknown="$(migration_diff "$LOCAL_REPO:$tag" unknown)" || die "migration check failed; nothing started"
  [[ -z "$unknown" ]] ||
    die "the DEV database has migrations $LOCAL_REPO:$tag lacks ($(echo $unknown)); refusing to start an older image"
  pending="$(migration_diff "$LOCAL_REPO:$tag" pending)" || die "migration check failed; nothing started"
  if [[ -n "$pending" ]]; then
    info "the image has $(echo "$pending" | wc -l | tr -d ' ') migration(s) the DEV database has not applied; backing up first"
    backup="$(backup_dev_data "local-up-$(image_sha "$LOCAL_REPO:$tag" | cut -c1-12)")" ||
      die "backup failed; nothing migrated or started"
  fi
  compose local up -d --no-build --pull never --wait --wait-timeout 300 "$@" || die "local mode did not start cleanly"
  compose local ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
  [[ -z "$backup" ]] || info "pre-migration backup: $backup"
}

# Local-mode containers of this project, running or stopped ("<name>" per line).
local_containers() {
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Names}}|{{.Label "com.docker.compose.project.config_files"}}' |
    while IFS='|' read -r name files; do
      # `if`, not `&&`: a last non-local line must not make the loop (and set -e callers) fail.
      if [[ -n "$name" && "$(mode_of_files "$files")" == local ]]; then echo "$name"; fi
    done
}

# DP-280: first-install bootstrap. Before anything is built: allowed only when there is no
# :current yet (first install, and no local-mode container exists) or when :current already is
# this commit (a repeated run, a no-op). An existing installation is updated by the normal
# sync-main (backup, deploy, verify, :previous), never by the bootstrap.
bootstrap_precheck() {
  local sha="$1" cur_sha leftover
  if [[ -n "$(image_id "$LOCAL_REPO:current")" ]]; then
    cur_sha="$(image_sha "$LOCAL_REPO:current")"
    [[ "$cur_sha" == "$sha" ]] ||
      die "an installation exists ($LOCAL_REPO:current = ${cur_sha:0:12}); --bootstrap is for the first install only. Update with: infra/docker/stack.sh sync-main (nothing changed)"
    return 0
  fi
  leftover="$(local_containers | tr '\n' ' ')"
  [[ -z "${leftover// /}" ]] ||
    die "no $LOCAL_REPO:current, but local-mode containers exist (${leftover% }); refusing to bootstrap (nothing changed)"
}

# DP-280: after build and tests passed, make the tested image :current if there is none. Never
# touches :previous; never replaces another image; a repeated run with the same image is a no-op.
bootstrap_promote() {
  local image="$1" sha="$2" cur_id new_id
  new_id="$(image_id "$image")"
  [[ -n "$new_id" && "$(image_sha "$image")" == "$sha" ]] || die "$image is not the tested image of ${sha:0:12}; nothing promoted"
  cur_id="$(image_id "$LOCAL_REPO:current")"
  if [[ -z "$cur_id" ]]; then
    [[ -z "$(local_containers)" ]] || die "local-mode containers appeared; nothing promoted"
    docker tag "$image" "$LOCAL_REPO:current" || die "could not tag $LOCAL_REPO:current"
    log_history "bootstrap ${sha:0:12} -> current"
    info "first install: $image is now $LOCAL_REPO:current (no :previous). Next: infra/docker/stack.sh switch local --yes"
  elif [[ "$cur_id" == "$new_id" ]]; then
    info "$LOCAL_REPO:current already is ${sha:0:12}; nothing changed"
  else
    die "$LOCAL_REPO:current changed to another image during the run; nothing promoted"
  fi
}

# sync-main [--sha <sha>] [--no-deploy | --bootstrap] [--check]: build one origin/main commit from an archive
# (never the working tree), test the image in the disposable test project, back up the DEV data,
# deploy, verify, then promote; on failure roll back the code (no migration applied) or stop
# safely (a migration was applied). --bootstrap (DP-280) builds and tests like --no-deploy and then
# makes the image :current on a first install only (see bootstrap_precheck).
sync_main() {
  local want="" deploy=1 check=0 bootstrap=0 arg
  while (( $# )); do
    arg="$1"; shift
    case "$arg" in
      --sha) want="${1:?--sha <commit>}"; shift ;;
      --no-deploy) deploy=0 ;;
      --bootstrap) deploy=0; bootstrap=1 ;;
      --check) check=1 ;;
      *) die "sync-main [--sha <commit>] [--no-deploy | --bootstrap] [--check]" ;;
    esac
  done
  command -v git >/dev/null || die "git is required on the host"

  # 1. The commit: origin/main, or an ancestor of it named with --sha.
  info "fetching origin main"
  git -C "$ROOT" fetch --no-tags --quiet origin "+refs/heads/main:refs/remotes/origin/main" ||
    die "git fetch origin main failed"
  local main sha sha12
  main="$(git -C "$ROOT" rev-parse --verify --quiet 'refs/remotes/origin/main^{commit}')" || die "origin/main unknown"
  if [[ -n "$want" ]]; then
    sha="$(git -C "$ROOT" rev-parse --verify --quiet "$want^{commit}")" || die "unknown commit $want"
    git -C "$ROOT" merge-base --is-ancestor "$sha" "$main" ||
      die "$sha is not on origin/main; only merged main commits are deployed"
  else
    sha="$main"
  fi
  sha12="${sha:0:12}"
  info "commit $sha12 ($(git -C "$ROOT" log -1 --format=%s "$sha" | cut -c1-72))"

  # 2. Mode: deploying needs the local stack running, or nothing running. A dev/prod stack must
  # be switched explicitly first (ADR-029 D3); building alone (--no-deploy) is allowed.
  local modes
  modes="$(running_modes | awk '{print $1}' | sort -u | tr '\n' ' ')"; modes="${modes% }"
  if (( deploy )) && [[ -n "$modes" && "$modes" != local ]]; then
    die "the $modes stack is running; deploy only into local mode (stack.sh switch local), or build with --no-deploy"
  fi

  # DP-280: refuse a bootstrap over an existing installation before anything is built.
  (( ! bootstrap )) || bootstrap_precheck "$sha"

  acquire_heavy_lock "sync-main $sha12"

  # 3. Isolated checkout: an archive of the commit in a temporary directory.
  SYNC_WORK="$(mktemp -d "${TMPDIR:-/tmp}/dream-sync-main.XXXXXX")"
  trap 'rm -rf "$LOCK_DIR" "${SYNC_WORK:-}"' EXIT
  local work="$SYNC_WORK"
  mkdir "$work/src"
  git -C "$ROOT" archive --format=tar "$sha" | tar -x -C "$work/src" || die "git archive $sha12 failed"

  # 4. Build the runtime image (the target CI builds), budgeted and one heavy job at a time.
  local image="$LOCAL_REPO:$sha12"
  if [[ -n "$(image_id "$image")" && "$(image_sha "$image")" == "$sha" ]]; then
    info "$image already built; reusing it"
  else
    resource_check heavy:sync-main-build $(( BUILD_BUDGET_MB * MiB )) ||
      die "resource preflight for the image build failed; nothing was built"
    docker build --target runtime \
      --label "org.opencontainers.image.revision=$sha" \
      --label "com.dream-petroleum.platform=local-image" \
      -t "$image" -f "$work/src/infra/docker/Dockerfile" "$work/src" || die "image build failed; nothing deployed"
  fi
  if (( check )); then
    resource_check heavy:sync-main-check $(( BUILD_BUDGET_MB * MiB )) ||
      die "resource preflight for the check build failed; nothing deployed"
    docker build --target check --output type=cacheonly \
      -f "$work/src/infra/docker/Dockerfile" "$work/src" || die "quality gate (check build) failed; nothing deployed"
  fi

  # 5. Test the image in the disposable test project (tmpfs database, no ports, never DEV data).
  # The scripts of the same commit run, against this image.
  info "migration safety and role tests against $image (disposable test project)"
  DP_TEST_APP_IMAGE="$image" "$work/src/tools/test/migration-safety-test.sh" ||
    die "migration safety tests failed for $image; nothing deployed"
  DP_TEST_APP_IMAGE="$image" "$work/src/tools/test/db-roles-test.sh" ||
    die "database role tests failed for $image; nothing deployed"
  # Test hook (DP-280 fixture only): the tests count as failed, so nothing is promoted or deployed.
  [[ "${DREAM_SYNC_FAULT:-}" != test ]] ||
    die "fault injection (test only): tests forced to fail for $image; nothing promoted or deployed"
  log_history "built $sha12 tested"

  if (( bootstrap )); then
    bootstrap_promote "$image" "$sha"
    return 0
  fi
  if (( ! deploy )); then
    info "built and tested $image; not deployed (--no-deploy). Deploy: infra/docker/stack.sh sync-main --sha $sha12"
    return 0
  fi

  # 6. Deploy into local mode.
  check_db_identity
  check_auth_secrets local
  if [[ -z "$(running_modes)" ]]; then
    preflight local
  fi
  assert_volumes_free_for local
  local prev_id prev_sha new_id
  prev_id="$(image_id "$LOCAL_REPO:current")"
  prev_sha="$(image_sha "$LOCAL_REPO:current")"
  new_id="$(image_id "$image")"
  local_postgres_up || die "Postgres of the local mode did not become healthy; nothing deployed"
  pg_running_dev || die "$PG_CONTAINER does not serve the DEV database; nothing deployed"
  local before unknown backup
  unknown="$(migration_diff "$image" unknown)" || die "migration check failed; nothing deployed"
  [[ -z "$unknown" ]] ||
    die "the DEV database has migrations $image does not contain ($(echo $unknown)); refusing to deploy an older image"
  before="$(applied_migrations)" || die "could not read the applied migrations; nothing deployed"
  backup="$(backup_dev_data "sync-$sha12")" || die "backup failed; nothing deployed"

  # Promotion: :previous keeps the image being replaced, :current is what the stack runs.
  [[ -z "$prev_id" || "$prev_id" == "$new_id" ]] || docker tag "$prev_id" "$LOCAL_REPO:previous"
  docker tag "$image" "$LOCAL_REPO:current"
  local prev_label="none"
  [[ -z "$prev_sha" ]] || prev_label="${prev_sha:0:12}"
  [[ "$prev_id" != "$new_id" ]] || prev_label="$prev_label (same image)"
  info "deploying $sha12 (previous: $prev_label)"
  local ok=1
  compose local up -d --no-build --pull never --wait --wait-timeout 300 || ok=0
  if (( ok )); then local_verify "$work/src" || ok=0; fi
  # Test hook (DP-277 fixture only): force the verification to fail to exercise the failure paths.
  if (( ok )) && [[ "${DREAM_SYNC_FAULT:-}" == verify ]]; then
    echo "fault injection (test only): verification forced to fail" >&2
    ok=0
  fi
  if (( ok )); then
    log_history "promoted $sha12 previous=${prev_sha:0:12} backup=$backup"
    info "local mode runs $sha12; pre-migration backup: $backup"
    return 0
  fi

  # 7. Failure: roll back the code if the database is unchanged, otherwise stop safely.
  local after
  after="$(applied_migrations)" || after="unreadable"
  if [[ "$after" != "$before" ]]; then
    local_safe_stop "deploy of $sha12 failed after applying migration(s); a code rollback is not safe on the changed schema" "$backup"
    exit 5
  fi
  if [[ -z "$prev_id" || "$prev_id" == "$new_id" ]]; then
    local_safe_stop "deploy of $sha12 failed and there is no previous image to return to" "$backup"
    exit 5
  fi
  info "deploy of $sha12 failed with the database unchanged; rolling back to ${prev_sha:0:12}"
  docker tag "$prev_id" "$LOCAL_REPO:current"
  docker tag "$image" "$LOCAL_REPO:failed"
  if compose local up -d --no-build --pull never --force-recreate --wait --wait-timeout 300 "${LOCAL_APP_SERVICES[@]}" &&
    local_verify "$ROOT"; then
    log_history "rolled-back $sha12 -> ${prev_sha:0:12} backup=$backup"
    echo "ROLLED BACK: $sha12 failed its checks; local mode runs ${prev_sha:0:12} again (database unchanged)." >&2
    exit 4
  fi
  local_safe_stop "deploy of $sha12 failed and the rollback to ${prev_sha:0:12} failed too" "$backup"
  exit 5
}

# local rollback: run :previous again. Only when the database has no migration the previous image
# lacks; otherwise the data must be restored first, which is an owner decision.
local_rollback() {
  acquire_heavy_lock "local rollback"
  require_running_mode local
  require_local_image previous
  local cur_id prev_id unknown backup
  cur_id="$(image_id "$LOCAL_REPO:current")"
  prev_id="$(image_id "$LOCAL_REPO:previous")"
  [[ "$cur_id" != "$prev_id" ]] || die ":previous is the running image; nothing to roll back"
  unknown="$(migration_diff "$LOCAL_REPO:previous" unknown)" || die "migration check failed; nothing changed"
  [[ -z "$unknown" ]] ||
    die "the DEV database has migrations the previous image lacks ($(echo $unknown)); a code rollback would break it. Restoring the pre-migration backup is an owner decision (ADR-029 D6); nothing changed"
  backup="$(backup_dev_data "rollback")" || die "backup failed; nothing changed"
  docker tag "$cur_id" "$LOCAL_REPO:previous"
  docker tag "$prev_id" "$LOCAL_REPO:current"
  if compose local up -d --no-build --pull never --force-recreate --wait --wait-timeout 300 "${LOCAL_APP_SERVICES[@]}" &&
    local_verify "$ROOT"; then
    log_history "rollback $(image_sha "$LOCAL_REPO:previous" | cut -c1-12) -> $(image_sha "$LOCAL_REPO:current" | cut -c1-12) backup=$backup"
    info "local mode runs $(image_sha "$LOCAL_REPO:current" | cut -c1-12) again"
    return 0
  fi
  local_safe_stop "rollback to $(image_sha "$LOCAL_REPO:current" | cut -c1-12) failed its checks" "$backup"
  exit 5
}

# switch <local|dev> --yes: the controlled change of the mode that serves the DEV data. One way at
# a time: check the target first, back up, stop the old mode (containers removed, every volume
# kept), start the new mode, verify. A failed start stops safely; it never starts the old mode
# again by itself. Called with the heavy-job lock held (stack.sh).
switch_mode() {
  local target="${1:-}"; shift || true
  [[ "$target" == local || "$target" == dev ]] || die "switch local|dev --yes"
  require_yes "$@"
  local from modes backup="" rc
  modes="$(running_modes | awk '{print $1}' | sort -u | tr '\n' ' ')"; modes="${modes% }"
  case "$modes" in
    "$target") die "the $target mode is already running; nothing changed" ;;
    "") from="" ;;
    dev | local) from="$modes" ;;
    *) die "running: $modes. switch moves only between dev and local; stop other stacks first" ;;
  esac
  # Everything the target needs is checked before the old mode stops.
  check_db_identity
  check_auth_secrets "$target"
  if [[ "$target" == local ]]; then
    require_local_image current
    image_migrations "$LOCAL_REPO:current" >/dev/null || die "cannot read $LOCAL_REPO:current; nothing changed"
    [[ -n "$(image_id "$PG_IMAGE")" && -n "$(image_id caddy:2.11.6-alpine)" ]] ||
      die "$PG_IMAGE or caddy:2.11.6-alpine is missing locally; nothing changed"
  fi
  if [[ -n "$from" ]]; then
    pg_running_dev || die "the running $from stack does not serve the DEV database; nothing changed"
    backup="$(backup_dev_data "switch-$from-to-$target")" || die "backup failed; nothing changed"
    info "stopping $from mode (containers removed, volumes kept)"
    compose "$from" down || die "could not stop the $from mode"
  fi
  log_history "switch ${from:-none} -> $target backup=${backup:-none}"
  # The start runs in a subshell with `set -e`, so any failing step ends it and lands here.
  set +e
  if [[ "$target" == local ]]; then
    (set -e; local_up; local_verify "$ROOT")
  else
    (set -e; cmd_mode dev up; smoke)
  fi
  rc=$?
  set -e
  if (( rc == 0 )); then
    info "switched to $target mode"
    return 0
  fi
  compose "$target" stop >&2 || true
  log_history "switch ${from:-none} -> $target FAILED (safe stop)"
  echo "SAFE STOP: the $target mode did not start cleanly; its containers are stopped, volumes untouched." >&2
  [[ -z "$backup" ]] || echo "  Backup taken before the switch: $backup" >&2
  [[ -z "$from" ]] || echo "  To return: infra/docker/stack.sh $target down && infra/docker/stack.sh $from up" >&2
  exit 5
}
