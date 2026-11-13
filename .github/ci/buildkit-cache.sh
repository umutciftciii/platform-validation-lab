#!/usr/bin/env bash
# BuildKit layer cache for the Docker job (GitHub Actions cache backend, scope "deps").
#
#   enable   switch the runner's Docker engine to the containerd image store, which lets the
#            default "docker" BuildKit driver import/export the gha cache; the stack scripts keep
#            using the default builder unchanged.
#   deps     build the Dockerfile "deps" stage (base image + system packages + pnpm install) with
#            --cache-from the main-branch cache, so the later `compose up --build` reuses those
#            layers. Writes the cache only when CACHE_WRITE=true (main, schedule, manual runs).
#
# Best effort by design: a cache miss or a cache service error only costs time, never a result.
set -euo pipefail

case "${1:-}" in
  enable)
    cfg=/etc/docker/daemon.json
    current='{}'
    if sudo test -s "$cfg"; then current="$(sudo cat "$cfg")"; fi
    jq '.features["containerd-snapshotter"] = true' <<<"$current" | sudo tee "$cfg" >/dev/null
    sudo systemctl restart docker
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info -f 'storage driver: {{.Driver}}; image store: {{.DriverStatus}}'
    ;;
  deps)
    args=(--target deps -f infra/docker/Dockerfile --cache-from "type=gha,scope=deps")
    if [[ "${CACHE_WRITE:-false}" == true ]]; then
      args+=(--cache-to "type=gha,mode=max,scope=deps,ignore-error=true")
    fi
    start=$SECONDS
    if docker buildx build "${args[@]}" .; then
      echo "dependency layers ready in $((SECONDS - start))s (cache write: ${CACHE_WRITE:-false})"
    else
      echo "::warning::dependency layer build failed ($((SECONDS - start))s); the stack build rebuilds them"
    fi
    ;;
  *)
    echo "usage: $0 enable|deps" >&2
    exit 2
    ;;
esac
