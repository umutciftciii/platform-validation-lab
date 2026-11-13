#!/usr/bin/env bash
# ADR-012A: apply infra/docker/postgres/dp-roles.sql to the database of a RUNNING postgres
# container, as that container's superuser over its local socket. Used for databases whose data
# directory already existed (the init script never runs there), by the test scripts and by CI.
#
#   DP_APP_PASSWORD=… DP_MIGRATOR_PASSWORD=… DP_IAM_BOOTSTRAP_PASSWORD=… \
#     infra/docker/postgres/apply-roles.sh <container> <dev|prod|test> [database]
#
# The passwords are passed to `docker exec` by name (-e VAR), never as values on a command line,
# and the SQL is streamed on stdin, so the container needs no bind mount. Idempotent.
set -euo pipefail

container="${1:?usage: apply-roles.sh <container> <dev|prod|test> [database]}"
profile="${2:?usage: apply-roles.sh <container> <dev|prod|test> [database]}"
database="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"

for v in DP_APP_PASSWORD DP_MIGRATOR_PASSWORD DP_IAM_BOOTSTRAP_PASSWORD; do
  [[ -n "${!v:-}" ]] || { echo "apply-roles: $v is not set" >&2; exit 1; }
done
export DP_APP_PASSWORD DP_MIGRATOR_PASSWORD DP_IAM_BOOTSTRAP_PASSWORD
export DP_ROLES_PROFILE="$profile" DP_ROLES_DATABASE="$database"

docker exec -i \
  -e DP_APP_PASSWORD -e DP_MIGRATOR_PASSWORD -e DP_IAM_BOOTSTRAP_PASSWORD \
  -e DP_ROLES_PROFILE -e DP_ROLES_DATABASE \
  "$container" sh -c '
    exec psql -X -q -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" \
      -d "${DP_ROLES_DATABASE:-$POSTGRES_DB}" \
      -v dp_app_password="$DP_APP_PASSWORD" \
      -v dp_migrator_password="$DP_MIGRATOR_PASSWORD" \
      -v dp_iam_bootstrap_password="$DP_IAM_BOOTSTRAP_PASSWORD" \
      -v dp_profile="$DP_ROLES_PROFILE" \
      -f -' < "$here/dp-roles.sql"
