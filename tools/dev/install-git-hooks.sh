#!/bin/sh
# Explicit opt-in installer. Never clobber an existing hooksPath or custom Git hooks.
set -eu
root="$(git rev-parse --show-toplevel)"
cd "$root"
[ -f .githooks/pre-push ] && [ -f .githooks/pre-commit ] || {
  echo "Missing versioned hooks" >&2; exit 1;
}
current="$(git config --local --get core.hooksPath || true)"
if [ -n "$current" ]; then
  if [ "$current" = ".githooks" ]; then
    echo "Git hooks already installed (.githooks)."
    exit 0
  fi
  echo "Refusing to replace existing core.hooksPath=$current" >&2
  exit 1
fi
# Even with no hooksPath, do not silently disable existing custom hooks.
legacy="$(git rev-parse --git-path hooks)"
for hook in pre-commit pre-push; do
  if [ -f "$legacy/$hook" ]; then
    echo "Refusing to supersede existing $legacy/$hook" >&2
    exit 1
  fi
done
for hook in pre-commit pre-push; do
  if [ ! -x ".githooks/$hook" ]; then
    echo ".githooks/$hook is not executable; check Git file mode" >&2
    exit 1
  fi
done
git config --local core.hooksPath .githooks
echo "Installed versioned hooks in this checkout only. Main pushes/commits blocked by default."
