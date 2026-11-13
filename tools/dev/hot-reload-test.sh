#!/usr/bin/env bash
# Hot reload check for the dev stack (infra/docker/stack.sh dev up must be running).
# Needs only bash, curl, perl and shasum/sha256sum on the host.
#
# For each target it: records the file's SHA-256, inserts a unique marker, waits until the
# running service serves the marker without a container restart, restores the original bytes,
# checks the SHA-256 is back to the recorded value, and waits until the marker is gone.
# The original file is restored on any exit (trap), including Ctrl-C and failures.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIMEOUT="${HOT_RELOAD_TIMEOUT:-120}"
MARK="HRTEST$(date +%s)$$"
BACKUP_DIR="$(mktemp -d)"
FAIL=0

sha() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }

# name | file | perl substitution (MARK is substituted) | url | container
TARGETS=(
  "web-bv demo page|apps/web-bv/app/demo/iccsyn-hero-products/page.tsx|s/ICCSYN hero with product groups/ICCSYN hero with product groups MARK/|http://127.0.0.1:3110/demo/iccsyn-hero-products|dream-platform-web-bv"
  "web-corporate page|apps/web-corporate/app/page.tsx|s/Corporate site skeleton/Corporate site skeleton MARK/|http://127.0.0.1:3111/|dream-platform-web-corporate"
  "admin page|apps/admin/app/page.tsx|s/Admin skeleton/Admin skeleton MARK/|http://127.0.0.1:3112/|dream-platform-admin"
  "api controller|apps/api/src/health/health.controller.ts|s/return healthResponse\\(\"api\", APP_VERSION\\);/return healthResponse(\"api\", APP_VERSION + \"-MARK\");/|http://127.0.0.1:3113/health|dream-platform-api"
  "shared contract -> web-corporate|packages/contracts/src/health.ts|s/^    version,$/    version: version + \"-MARK\",/|http://127.0.0.1:3111/api/health|dream-platform-web-corporate"
)

CURRENT=""
restore() {
  if [[ -n "$CURRENT" && -f "$BACKUP_DIR/current" ]]; then
    cp "$BACKUP_DIR/current" "$ROOT/$CURRENT"
    CURRENT=""
  fi
}
trap 'restore; rm -rf "$BACKUP_DIR"' EXIT INT TERM

wait_for() { # url, expect(present|absent)
  local url="$1" expect="$2" start=$SECONDS body
  while (( SECONDS - start < TIMEOUT )); do
    body="$(curl -s -m 30 "$url" || true)"
    if [[ "$expect" == present && "$body" == *"$MARK"* ]]; then echo $((SECONDS - start)); return 0; fi
    if [[ "$expect" == absent && -n "$body" && "$body" != *"$MARK"* ]]; then echo $((SECONDS - start)); return 0; fi
    sleep 1
  done
  return 1
}

printf '%-34s %-10s %-10s %-9s %-8s %s\n' TARGET APPLIED REVERTED SHA RESTART RESULT
for t in "${TARGETS[@]}"; do
  IFS='|' read -r name file subst url container <<<"$t"
  path="$ROOT/$file"
  before="$(sha "$path")"
  started="$(docker inspect -f '{{.State.StartedAt}}' "$container")"
  cp "$path" "$BACKUP_DIR/current"; CURRENT="$file"

  perl -pi -e "${subst//MARK/$MARK}" "$path"
  if [[ "$(sha "$path")" == "$before" ]]; then
    restore; printf '%-34s %s\n' "$name" "FAIL: substitution did not match"; FAIL=1; continue
  fi

  applied="$(wait_for "$url" present)" || applied="timeout"
  restore
  after="$(sha "$path")"
  [[ "$after" == "$before" ]] && shaok="same" || shaok="CHANGED"
  reverted="$(wait_for "$url" absent)" || reverted="timeout"
  [[ "$(docker inspect -f '{{.State.StartedAt}}' "$container")" == "$started" ]] && restarted="no" || restarted="yes"

  result="PASS"
  [[ "$applied" == timeout || "$reverted" == timeout || "$shaok" != same || "$restarted" != no ]] && { result="FAIL"; FAIL=1; }
  printf '%-34s %-10s %-10s %-9s %-8s %s\n' "$name" "${applied}s" "${reverted}s" "$shaok" "$restarted" "$result"
  echo "  $file sha256 before=$before after=$after"
done

exit $FAIL
