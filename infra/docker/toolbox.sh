#!/usr/bin/env bash
# Runs a command with the platform toolchain (Node 24 + pnpm) in a throwaway container,
# against a copy of the working tree. The host folders stay free of Linux node_modules.
#
#   infra/docker/toolbox.sh 'pnpm install --frozen-lockfile && pnpm check'
#   infra/docker/toolbox.sh --lockfile        # refresh pnpm-lock.yaml only
#
# Uses only resources named dream-petroleum-platform-*; touches no other Docker project.
# Heavy job: runs one at a time (lock), fails fast unless the Docker VM can grant its budget and
# keep a reserve for other projects, and is hard-limited (memory without swap, CPUs, Node heap).
# Budget overrides: TOOLBOX_MEM=3072m TOOLBOX_CPUS=4 TOOLBOX_HEAP_MB=1536 (see lib.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$ROOT/infra/docker/lib.sh"
IMAGE="${TOOLBOX_IMAGE:-$NODE_IMAGE}"
# Optional, for the integration tests: TOOLBOX_NETWORK joins a Docker network and
# TOOLBOX_ENV_FILE passes extra variables (file is read by docker, never echoed).
EXTRA=()
[[ -n "${TOOLBOX_NETWORK:-}" ]] && EXTRA+=(--network "$TOOLBOX_NETWORK")
# docker lets -e override --env-file, so the placeholder DATABASE_URL is set only without a file.
if [[ -n "${TOOLBOX_ENV_FILE:-}" ]]; then
  EXTRA+=(--env-file "$TOOLBOX_ENV_FILE")
else
  EXTRA+=(-e DATABASE_URL="postgresql://toolbox:toolbox@127.0.0.1:5432/toolbox")
fi
cd "$ROOT"

if heavy_lock_inherited; then
  info "toolbox runs inside heavy job pid $DREAM_HEAVY_LOCK_OWNER (lock and budget held there)"
else
  acquire_heavy_lock "toolbox"
  resource_check heavy:toolbox "$(to_bytes "$TOOLBOX_MEM")" >&2 ||
    die "resource preflight for the toolbox failed; nothing was started"
fi

run() {
  git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf - | docker run --rm -i \
    --name "dream-petroleum-platform-toolbox-$$" \
    --label com.dream-petroleum.platform=toolbox \
    --memory "$TOOLBOX_MEM" --memory-swap "$TOOLBOX_MEM" --cpus "$TOOLBOX_CPUS" \
    -e NODE_OPTIONS="--max-old-space-size=$TOOLBOX_HEAP_MB" \
    -v dream-petroleum-platform_pnpm-store:/pnpm-store \
    -v dream-petroleum-platform_corepack:/corepack \
    -e COREPACK_HOME=/corepack -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e CI=1 -e NEXT_TELEMETRY_DISABLED=1 -e TURBO_TELEMETRY_DISABLED=1 \
    --user root ${EXTRA[@]+"${EXTRA[@]}"} \
    -w /work "$IMAGE" bash -c "tar -xf - && corepack enable && pnpm config set store-dir /pnpm-store >/dev/null && $1"
}

if [[ "${1:-}" == "--lockfile" ]]; then
  run 'pnpm install --lockfile-only >&2 && cat pnpm-lock.yaml' > pnpm-lock.yaml.tmp
  mv pnpm-lock.yaml.tmp pnpm-lock.yaml
  echo "pnpm-lock.yaml updated" >&2
else
  run "$*"
fi
