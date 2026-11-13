#!/usr/bin/env bash
# ADR-012A: runs once, when the official postgres image initialises an EMPTY data directory
# (/docker-entrypoint-initdb.d). Existing data directories never run it; for those the operator
# uses `infra/docker/stack.sh db-roles <mode>` (same SQL file). A failure here stops the
# container, so a database without its roles never starts.
set -euo pipefail

for v in DP_APP_PASSWORD DP_MIGRATOR_PASSWORD DP_IAM_BOOTSTRAP_PASSWORD DP_ROLES_PROFILE; do
  if [[ -z "${!v:-}" ]]; then
    echo "10-dp-roles: $v is not set; refusing to initialise the database without its roles" >&2
    exit 1
  fi
done

psql -X -v ON_ERROR_STOP=1 --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dp_app_password="$DP_APP_PASSWORD" \
  -v dp_migrator_password="$DP_MIGRATOR_PASSWORD" \
  -v dp_iam_bootstrap_password="$DP_IAM_BOOTSTRAP_PASSWORD" \
  -v dp_profile="$DP_ROLES_PROFILE" \
  -f /dp/dp-roles.sql
