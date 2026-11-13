# shellcheck shell=bash
# Readiness probe and credential masking shared by tools/dev/db-isolation-test.sh.
# Sourced, not executed. Tested by tools/dev/readiness-test.sh.
#
# The caller sets API_READY (the /health/ready URL). Optional knobs (defaults = previous behaviour):
#   READY_ATTEMPTS        number of probes before giving up        (30)
#   READY_INTERVAL        seconds between probes                   (2)
#   READY_CURL_TIMEOUT    curl --max-time for one probe, seconds   (20)
#   READY_LOG_CONTAINER   container whose last log lines are shown when the API was not
#                         ready at the first probe or never became ready (dream-platform-api)
#
# Callers run under `set -euo pipefail`. A plain `code="$(curl ...)"` aborts the whole script
# when curl exits non-zero (7 connection refused, 28 timeout, 56 connection reset while the API
# restarts), before any retry happens. Every curl call here therefore captures its exit status
# instead of letting it escape.

: "${READY_ATTEMPTS:=30}"
: "${READY_INTERVAL:=2}"
: "${READY_CURL_TIMEOUT:=20}"
: "${READY_LOG_CONTAINER:=dream-platform-api}"

READY_NOTE=""
READY_CODE=""
READY_CURL_RC=0

# One probe. Sets READY_CODE (3-digit HTTP status; 000 = no HTTP answer) and READY_CURL_RC
# (curl's exit status). Never fails, so it is safe under `set -e`.
ready_probe() {
  READY_CURL_RC=0
  READY_CODE="$(curl -s -m "$READY_CURL_TIMEOUT" -o /dev/null -w '%{http_code}' "$API_READY")" ||
    READY_CURL_RC=$?
  [[ "$READY_CODE" =~ ^[0-9]{3}$ ]] || READY_CODE="000"
}

# Prints the HTTP status of one probe (000 when there was no HTTP answer). Always exits 0; the
# caller compares the value, so a failed probe is a FAIL, never a silent pass or an abort.
ready_code() {
  ready_probe
  echo "$READY_CODE"
}

# Prints the database detail of /health/ready, or nothing. Always exits 0.
ready_detail() {
  { curl -s -m "$READY_CURL_TIMEOUT" "$API_READY" || true; } |
    sed -n 's/.*"database":{[^}]*"detail":"\([^"]*\)".*/\1/p'
}

describe_probe() { # "503" or "000 (curl exit 56)"
  if [[ "$READY_CURL_RC" -ne 0 ]]; then echo "$READY_CODE (curl exit $READY_CURL_RC)"; else echo "$READY_CODE"; fi
}

show_api_logs() {
  docker logs --tail 15 "$READY_LOG_CONTAINER" 2>&1 | redact | sed 's/^/        /' || true
}

# Waits, bounded by READY_ATTEMPTS x (READY_CURL_TIMEOUT + READY_INTERVAL), until /health/ready
# answers HTTP 200. Connection errors and non-200 answers are retried alike. Returns 0 when ready
# and 1 when it never was; READY_NOTE records attempts, the first failed answer and the last one.
# It never decides PASS/FAIL itself: the caller's 200 check does, so a real readiness failure
# still shows up as FAIL.
wait_ready() {
  local i first="" last=""
  for ((i = 1; i <= READY_ATTEMPTS; i++)); do
    ready_probe
    if [[ "$READY_CODE" == 200 ]]; then
      READY_NOTE="ready after $i attempt(s)${first:+; first answer $first}"
      if [[ -n "$first" ]]; then
        echo "  note: API was not ready at the first request ($first); last API log lines:"
        show_api_logs
      fi
      return 0
    fi
    last="$(describe_probe)"
    [[ -n "$first" ]] || first="$last"
    ((i < READY_ATTEMPTS)) && sleep "$READY_INTERVAL"
  done
  READY_NOTE="not ready after $READY_ATTEMPTS attempts (first answer $first, last $last)"
  echo "  note: API never became ready ($READY_NOTE); last API log lines:"
  show_api_logs
  return 1
}

# Masks credentials in diagnostic output. Diagnostics never print .env or container environments;
# this is the second line of defence for log lines that echo a connection string or a header.
#   - userinfo in any URL:            scheme://user:secret@host  -> scheme://***@host
#   - postgres connection strings:    postgres(ql)://...         -> postgres(ql)://***
#   - key=value / key: value / JSON "key":"value" for keys containing PASSWORD, PASSWD, PWD,
#     SECRET, TOKEN, KEY, CREDENTIAL (any case, any prefix such as DATABASE_URL's PG*)
#   - Authorization / Proxy-Authorization headers (rest of the value) and Bearer/Basic tokens
# Bracket expressions avoid \r/\n escapes: BSD sed (macOS) reads them as the letters r and n.
redact() {
  sed -E \
    -e 's#(postgres(ql)?://)[^[:space:]"'"'"']*#\1***#g' \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]"'"'"']+@#\1***@#g' \
    -e 's#((Proxy-)?[Aa]uthorization"?[[:space:]]*[:=][[:space:]]*"?)[^"]*#\1***#g' \
    -e 's#([Bb]earer|[Bb]asic)[[:space:]]+[A-Za-z0-9._~+/=-]+#\1 ***#g' \
    -e 's#(([A-Za-z0-9_.-]*([Pp][Aa][Ss][Ss]([Ww][Oo][Rr][Dd]|[Ww][Dd])?|[Pp][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Kk][Ee][Yy]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll])[A-Za-z0-9_.-]*)"?[[:space:]]*[=:][[:space:]]*"?)[^[:space:]",}]+#\1***#g'
}
