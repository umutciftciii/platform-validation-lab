#!/usr/bin/env bash
# All tests run in a disposable local repo and bare remote. Never contact GitHub.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git init -q --bare "$tmp/remote.git"
git init -q "$tmp/work"
cd "$tmp/work"
git config user.name "Local Guard Test"
git config user.email "guard-test@example.invalid"
git config init.defaultBranch main
git switch -q -c main
echo base > sample.txt
git add sample.txt
git commit -qm base
git remote add origin "$tmp/remote.git"
git push -q origin main
git switch -q -c feature/test
echo feature >> sample.txt
git add sample.txt
git commit -qm feature
mkdir -p .githooks tools/dev
cp "$root/.githooks/pre-push" "$root/.githooks/pre-commit" .githooks/
cp "$root/tools/dev/install-git-hooks.sh" tools/dev/
chmod +x .githooks/pre-push .githooks/pre-commit
sh tools/dev/install-git-hooks.sh >/dev/null
[ "$(git config --local --get core.hooksPath)" = ".githooks" ]

expect_fail() {
  if "$@" >"$tmp/stdout" 2>"$tmp/stderr"; then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
}
# Ordinary feature pushes work.
git push -q origin HEAD:refs/heads/feature/test
# Main updates, deletes, force pushes and --all are denied.
expect_fail git push origin HEAD:refs/heads/main
expect_fail git push origin :refs/heads/main
expect_fail git push --force origin HEAD:refs/heads/main
# --all only passes refs with pending updates to pre-push. Make local main
# genuinely ahead of remote main, without bypassing or installing anything.
git update-ref refs/heads/main "$(git rev-parse HEAD)"
expect_fail git push --all origin
# Per-command opt-in alone is insufficient; local reason alone is insufficient.
expect_fail env DREAM_ALLOW_MAIN_PUSH=1 git push origin HEAD:refs/heads/main
git config --local dream.pushGuard.reason "test one-time approval"
expect_fail git push origin HEAD:refs/heads/main
DREAM_ALLOW_MAIN_PUSH=1 git push -q origin HEAD:refs/heads/main
! git config --local --get dream.pushGuard.reason >/dev/null
grep -q "test one-time approval" "$(git rev-parse --git-path dream-push-guard.log)"
# Exception was consumed; subsequent push back to main still rejected.
echo next >> sample.txt
git add sample.txt
git commit -qm next
expect_fail git push origin HEAD:refs/heads/main
# Direct main commits denied, feature commits allowed.
git switch -q main
echo direct >> sample.txt
git add sample.txt
expect_fail git commit -m forbidden
git reset -q --hard HEAD
git switch -q feature/test
# Installer idempotency / existing hooksPath refusal.
sh tools/dev/install-git-hooks.sh >/dev/null
git config --local core.hooksPath "$tmp/other-hooks"
expect_fail sh tools/dev/install-git-hooks.sh
[ "$(git config --local --get core.hooksPath)" = "$tmp/other-hooks" ]
echo "Git hook regression checks PASS (local disposable repositories only)"
