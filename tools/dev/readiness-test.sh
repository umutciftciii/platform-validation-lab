#!/usr/bin/env bash
# Tests tools/dev/lib-readiness.sh (wait_ready, ready_code, ready_detail, redact). Needs bash,
# curl and python3; no Docker, no database, no network beyond 127.0.0.1. Runs in a few seconds.
#
#   tools/dev/readiness-test.sh
#
# It runs under the same `set -euo pipefail` as db-isolation-test.sh, because the bug it guards
# against (F1-001D) was an abort under `set -e`: `code="$(curl ...)"` ended the whole script when
# curl exited 56 (connection reset) on the first probe, before any retry.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
trap 'rm -rf "$WORK"; [[ -z "$SERVER_PID" ]] || kill "$SERVER_PID" 2>/dev/null || true' EXIT

PASS=0
FAIL=0
ok() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
expect_eq() { # description, expected, actual
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
expect_match() { # description, regex, actual
  if [[ "$3" =~ $2 ]]; then ok "$1"; else bad "$1 (got '$3')"; fi
}
section() { echo; echo "== $*"; }

# docker is only used for diagnostics (API log lines); a stub keeps the test Docker-free.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "stub api log: DATABASE_URL=postgresql://stub_user:stub-not-a-secret@postgres:5432/db"
EOF
chmod +x "$WORK/bin/docker"

# Fake curl driven by a scenario file: line N = "<http_code> <exit_status>" for probe N; the last
# line repeats. Each call is counted in $WORK/calls.
cat >"$WORK/fakecurl" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$FAKE_DIR/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$FAKE_DIR/calls"
line="$(sed -n "${n}p" "$FAKE_DIR/scenario")"; [[ -n "$line" ]] || line="$(tail -n 1 "$FAKE_DIR/scenario")"
read -r code rc <<<"$line"
# Like real curl, -w prints the status (000 without an HTTP answer) even when the exit is non-zero.
for a in "$@"; do [[ "$a" == "-w" ]] && printf '%s' "$code"; done
exit "$rc"
EOF
chmod +x "$WORK/fakecurl"

load_lib() { # fresh library state with fast, bounded settings
  READY_ATTEMPTS="${1:-5}" READY_INTERVAL="${2:-0}" READY_CURL_TIMEOUT="${3:-2}"
  unset READY_NOTE READY_CODE READY_CURL_RC
  # shellcheck source=tools/dev/lib-readiness.sh
  source "$ROOT/tools/dev/lib-readiness.sh"
}

# Runs a snippet in a child bash with `set -euo pipefail`, the fake curl first on PATH and the
# given scenario. Prints the snippet's output; the exit status is the snippet's.
with_fake_curl() { # scenario-lines, snippet
  local dir="$WORK/fake.$RANDOM$RANDOM"
  mkdir -p "$dir/bin"; cp "$WORK/fakecurl" "$dir/bin/curl"; cp "$WORK/bin/docker" "$dir/bin/docker"
  printf '%s\n' "$1" >"$dir/scenario"
  echo "$dir" >"$WORK/last" # with_fake_curl runs in $(...); the caller reads the dir from here
  FAKE_DIR="$dir" PATH="$dir/bin:$PATH" ROOT="$ROOT" API_READY="http://127.0.0.1:9/health/ready" \
    bash -c "set -euo pipefail; $(declare -f load_lib); $2"
}
calls_of_last() { cat "$(cat "$WORK/last")/calls"; }

section "1. Regression: the old probe aborts under set -e"
out="$(with_fake_curl "000 56" 'code="$(curl -s -o /dev/null -w "%{http_code}" "$API_READY")"; echo "survived $code"' 2>&1)" && rc=0 || rc=$?
expect_eq "old 'code=\$(curl)' with curl exit 56 aborts the script (rc 56)" "56" "$rc"
expect_eq "old probe never reached the retry" "" "$out"

section "2. First probe fails (connection reset), second answers 200"
out="$(with_fake_curl $'000 56\n200 0' 'load_lib 5 0; wait_ready; echo "rc=$? note=$READY_NOTE"')" && rc=0 || rc=$?
expect_eq "script survives curl exit 56 and wait_ready returns 0" "0" "$rc"
expect_match "READY_NOTE records attempt 2 and the curl exit" 'note=ready after 2 attempt\(s\); first answer 000 \(curl exit 56\)' "$out"
expect_eq "exactly 2 probes" "2" "$(calls_of_last)"
expect_match "diagnostic API log lines are printed after a late readiness" 'API was not ready at the first request' "$out"
if grep -q 'stub-not-a-secret' <<<"$out"; then bad "diagnostic log lines are masked"; else ok "diagnostic log lines are masked"; fi

section "3. Mixed failures: refused (7), timeout (28), 503, then 200"
out="$(with_fake_curl $'000 7\n000 28\n503 0\n200 0' 'load_lib 10 0; wait_ready; echo "rc=$? note=$READY_NOTE"')" && rc=0 || rc=$?
expect_eq "script survives curl exits 7 and 28" "0" "$rc"
expect_match "ready after 4 attempts, first answer recorded" 'note=ready after 4 attempt\(s\); first answer 000 \(curl exit 7\)' "$out"

section "4. Persistent connection failure: bounded, returns 1, the 200 check FAILs"
out="$(with_fake_curl "000 56" 'load_lib 3 0; if wait_ready; then echo "wr=0"; else echo "wr=$?"; fi; echo "note=$READY_NOTE"; c="$(ready_code)"; [[ "$c" == 200 ]] && echo CHECK=PASS || echo "CHECK=FAIL code=$c"')" && rc=0 || rc=$?
expect_eq "script survives a probe that never connects" "0" "$rc"
expect_match "wait_ready returns 1" 'wr=1' "$out"
expect_match "READY_NOTE says not ready after 3 attempts, first and last" 'note=not ready after 3 attempts \(first answer 000 \(curl exit 56\), last 000 \(curl exit 56\)\)' "$out"
expect_match "the caller's 200 check reports FAIL with code 000" 'CHECK=FAIL code=000' "$out"
expect_eq "exactly READY_ATTEMPTS probes plus the final check" "4" "$(calls_of_last)"
expect_match "the timeout is reported with API log lines" 'API never became ready' "$out"

section "5. Persistent non-200 answers are not ready (HTTP 200 stays mandatory)"
for code in 503 500 204 301; do
  out="$(with_fake_curl "$code 0" 'load_lib 2 0; wait_ready && echo wr=0 || echo wr=1; c="$(ready_code)"; [[ "$c" == 200 ]] && echo CHECK=PASS || echo CHECK=FAIL')"
  expect_match "HTTP $code: wait_ready returns 1 and the 200 check FAILs" $'wr=1\nCHECK=FAIL' "$out"
done

section "6. ready_code and ready_detail never abort the caller"
out="$(with_fake_curl "000 28" 'load_lib; x="$(ready_code)"; y="$(ready_detail)"; echo "code=$x detail=[$y]"')" && rc=0 || rc=$?
expect_eq "assignment from ready_code/ready_detail survives curl exit 28" "0" "$rc"
expect_eq "ready_code prints 000, ready_detail prints nothing" "code=000 detail=[]" "$out"

section "7. Timeout bound is kept (attempts x interval, no sleep after the last attempt)"
start=$SECONDS
out="$(with_fake_curl "000 7" 'load_lib 3 1; wait_ready || true; echo "$READY_NOTE"')"
elapsed=$((SECONDS - start))
if ((elapsed >= 2 && elapsed <= 4)); then ok "3 attempts at 1 s interval took ${elapsed}s (2..4)"; else bad "3 attempts at 1 s interval took ${elapsed}s (expected 2..4)"; fi
expect_eq "default bound is unchanged: 30 attempts, 2 s apart, 20 s per probe" "30 2 20" \
  "$(env -u READY_ATTEMPTS -u READY_INTERVAL -u READY_CURL_TIMEOUT bash -c "source '$ROOT/tools/dev/lib-readiness.sh'; echo \"\$READY_ATTEMPTS \$READY_INTERVAL \$READY_CURL_TIMEOUT\"")"

section "8. Real curl: closed port and a server that drops the first connection"
PATH="$WORK/bin:$PATH"
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
API_READY="http://127.0.0.1:$PORT/health/ready"
load_lib 3 0 2
if wait_ready; then bad "closed port: wait_ready returned 0"; else ok "closed port: wait_ready returns 1 without aborting"; fi
expect_match "closed port: real curl exit is recorded" 'curl exit [0-9]+' "$READY_NOTE"
expect_eq "closed port: ready_code is 000" "000" "$(ready_code)"

cat >"$WORK/server.py" <<'EOF'
import http.server, socketserver, sys
state = {"n": 0}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        state["n"] += 1
        if state["n"] == 1:              # first request: drop the connection, no HTTP answer
            self.close_connection = True
            self.connection.shutdown(2)
            return
        if state["n"] == 2:              # second: not ready yet
            body = b'{"status":"error"}'; self.send_response(503)
        else:
            body = b'{"checks":{"database":{"status":"ok","detail":"env=test db=fake"}}}'; self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
with socketserver.TCPServer(("127.0.0.1", int(sys.argv[1])), H) as s:
    print("listening", flush=True); s.serve_forever()
EOF
python3 -I "$WORK/server.py" "$PORT" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do grep -q listening "$WORK/server.log" 2>/dev/null && break; sleep 0.1; done
load_lib 5 0 2
if wait_ready; then ok "dropped connection, then 503, then 200: wait_ready returns 0"; else bad "server scenario: wait_ready returned 1 ($READY_NOTE)"; fi
expect_match "READY_NOTE: ready after 3 attempts, first answer had no HTTP status" 'ready after 3 attempt\(s\); first answer 000 \(curl exit (52|56)\)' "$READY_NOTE"
expect_eq "ready_detail reads the database detail" "env=test db=fake" "$(ready_detail)"

section "9. redact masks credentials and keeps ordinary text"
# Values below are fake and low-entropy on purpose; each must disappear from the output.
input='DATABASE_URL=postgresql://dream:fakepwone@postgres:5432/dream_platform?schema=public
error connecting to redis://cache_user:fakepwtwo@cache:6379/0
POSTGRES_PASSWORD=fakepwthree
pgpassword: fakepwfour
{"user":"x","password":"fakepwfive","detail":"env=prod"}
Authorization: Bearer fakepwsix
client_secret=fakepwseven
API_KEY: fakepweight
GET https://deploy:fakepwnine@example.invalid/hook
SHADOW_DATABASE_URL="mysql://root:fakepwten@db/x"
dev_token=fakepweleven
Proxy-Authorization: Basic fakepwtwelve'
masked="$(redact <<<"$input")"
leaks="$(grep -oE 'fakepw[a-z]+' <<<"$masked" | tr '\n' ' ' || true)"
expect_eq "no fake credential survives redact" "" "$leaks"
expect_match "hosts stay readable" 'postgresql://\*\*\*' "$masked"
expect_match "URL host after userinfo stays readable" '@example.invalid/hook' "$masked"
plain='  PASS  API /health/ready 200 (ready after 1 attempt(s); env=prod db=dream_platform)'
expect_eq "ordinary status line is unchanged" "$plain" "$(redact <<<"$plain")"

echo
echo "Readiness test: $PASS passed, $FAIL failed"
((FAIL == 0))
