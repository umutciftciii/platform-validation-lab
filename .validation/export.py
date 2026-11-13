#!/usr/bin/env python3
"""Deterministic, auditable export of a source revision into this validation repository.

The exported tree is built with Git plumbing only, so the result is a pure function of
(source commit, rules, overlay files): the same inputs always give the same tree id, on any
machine. File contents are copied byte for byte (no checkout, no line-ending filters), except
for the pseudonymised files listed in rules.json.

    tree(export) = overlay files of this repository
                 + source files, minus `exclude` (plus `include`), with `transform` applied
                 + .validation/source.json (manifest: source commit, rules digest, sub-trees)

Commands (run from the root of this repository; Python stdlib and git only):

  check-manifest [--rev REV]          CI: HEAD is internally consistent with its manifest.
  build  --source DIR --rev REV       Build the tree, print its id (writes objects locally).
  sync   --source DIR --rev REV --branch sync/NAME [--overlay TREEISH] [--push] [--pr]
  verify --source DIR --commit SHA    Recompute from the source and compare with a public commit.
  gate   --source DIR --pr N [--post-status]
                                      Merge gate for a source pull request (never merges).

`--source` is a local clone of the source repository. This repository never holds a token or
credential for it: `sync`, `verify` and `gate` run on a maintainer machine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

MANIFEST = ".validation/source.json"
RULES = ".validation/rules.json"
RESULT_CHECK = "CI result"


class ExportError(Exception):
    pass


def git(*args: str, cwd: str | None = None, data: bytes | None = None, env: dict | None = None) -> bytes:
    full_env = None
    if env:
        full_env = dict(os.environ)
        full_env.update(env)
    proc = subprocess.run(
        ["git", *args], cwd=cwd, input=data, capture_output=True, env=full_env, check=False
    )
    if proc.returncode != 0:
        raise ExportError(f"git {' '.join(args[:3])}…: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(f"^{out}$")


PRIVATE_RULES = os.environ.get(
    "VALIDATION_PRIVATE_RULES", os.path.expanduser("~/.config/platform-validation-lab/private-rules.json")
)


class Rules:
    """Public rules (rules.json in this repository) plus, for exports, the private replacement
    table. The table holds the original personal values, so it never enters this repository."""

    def __init__(self, raw: bytes, private: bool = False):
        self.raw = raw
        self.digest = hashlib.sha256(raw).hexdigest()
        data = json.loads(raw)
        if data.get("format") != 1:
            raise ExportError("unsupported rules format")
        self.overlay = list(data["overlay"]["prefixes"])
        self.exclude = [glob_to_regex(p) for p in data["exclude"]["patterns"]]
        self.include = set(data["include"]["paths"])
        self.forbidden_paths = [glob_to_regex(p) for p in data["forbidden_paths"]["patterns"]]
        self.forbidden_content = {k: re.compile(v) for k, v in data["forbidden_content"]["patterns"].items()}
        self.transform: dict[str, dict[str, str]] = {p: {} for p in data["transform"]["files"]}
        if private:
            self._load_private()

    def _load_private(self) -> None:
        try:
            with open(PRIVATE_RULES, encoding="utf-8") as fh:
                data = json.load(fh)
        except OSError as exc:
            raise ExportError(f"private rules not readable ({PRIVATE_RULES}): {exc.strerror}") from None
        if os.name == "posix" and os.stat(PRIVATE_RULES).st_mode & 0o077:
            raise ExportError(f"{PRIVATE_RULES} must not be readable by group or others (chmod 600)")
        table = data.get("transform", {})
        if set(table) != set(self.transform):
            raise ExportError("private replacement table and rules.json list different files")
        self.transform = table
        for name, rx in data.get("forbidden_content", {}).items():
            self.forbidden_content[f"private:{name}"] = re.compile(rx)

    def is_overlay(self, path: str) -> bool:
        return any(path == p or (p.endswith("/") and path.startswith(p)) for p in self.overlay)

    def is_excluded(self, path: str) -> bool:
        if path in self.include:
            return False
        return any(rx.match(path) for rx in self.exclude)


def ls_tree(treeish: str, cwd: str) -> list[tuple[str, str, str, str]]:
    raw = git("ls-tree", "-r", "-z", "--full-tree", treeish, cwd=cwd)
    entries = []
    for item in raw.split(b"\0"):
        if not item:
            continue
        meta, path = item.split(b"\t", 1)
        mode, kind, sha = meta.decode().split(" ")
        entries.append((mode, kind, sha, path.decode("utf-8")))
    return entries


class BlobReader:
    """One `git cat-file --batch` process per repository instead of a process per blob."""

    def __init__(self, cwd: str):
        self.proc = subprocess.Popen(
            ["git", "cat-file", "--batch"], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE
        )

    def read(self, sha: str) -> bytes:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(sha.encode() + b"\n")
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().split()
        if len(header) != 3 or header[1] != b"blob":
            raise ExportError(f"not a blob: {sha}")
        size = int(header[2])
        body = self.proc.stdout.read(size)
        self.proc.stdout.read(1)
        return body

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.wait()


def write_blob(content: bytes, repo: str) -> str:
    return git("hash-object", "-w", "--no-filters", "--stdin", cwd=repo, data=content).decode().strip()


def make_tree(entries: list[tuple[str, str, str]], repo: str) -> str:
    """entries: (mode, sha, path). Uses a throw-away index; the repository index is untouched."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}
        info = b"".join(f"{m} {s}\t{p}".encode("utf-8") + b"\0" for m, s, p in sorted(entries, key=lambda e: e[2]))
        git("update-index", "--add", "-z", "--index-info", cwd=repo, data=info, env=env)
        return git("write-tree", cwd=repo, env=env).decode().strip()


def manifest_bytes(manifest: dict) -> bytes:
    # Objects only (no arrays) and two-space indentation: stable and Prettier-clean.
    return (json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def build(source: str, rev: str, overlay: str, repo: str) -> dict:
    rules = Rules(git("show", f"{overlay}:{RULES}", cwd=repo), private=True)
    src_commit = git("rev-parse", "--verify", f"{rev}^{{commit}}", cwd=source).decode().strip()
    src_tree = git("rev-parse", f"{src_commit}^{{tree}}", cwd=source).decode().strip()

    exported: list[tuple[str, str, str]] = []
    excluded: list[str] = []
    replaced: list[str] = []
    transformed: dict[str, dict[str, str]] = {}
    problems: list[str] = []
    reader = BlobReader(source)
    try:
        for mode, kind, sha, path in ls_tree(src_commit, source):
            if kind != "blob":
                problems.append(f"{path}: unsupported entry type {kind}")
                continue
            if rules.is_overlay(path):
                replaced.append(path)
                continue
            if rules.is_excluded(path):
                excluded.append(path)
                continue
            if any(rx.match(path) for rx in rules.forbidden_paths):
                problems.append(f"{path}: forbidden path")
                continue
            content = reader.read(sha)
            if path in rules.transform:
                text = content.decode("utf-8")
                for old, new in rules.transform[path].items():
                    if old not in text:
                        problems.append(f"{path}: transform pattern no longer matches: {old!r}")
                    text = text.replace(old, new)
                content = text.encode("utf-8")
            for name, rx in rules.forbidden_content.items():
                if rx.search(content.decode("utf-8", errors="replace")):
                    problems.append(f"{path}: forbidden content ({name})")
            new_sha = write_blob(content, repo)
            if path not in rules.transform and new_sha != sha:
                problems.append(f"{path}: blob changed while copying")
            if path in rules.transform:
                transformed[path] = {"source_blob": sha, "export_blob": new_sha}
            exported.append((mode, new_sha, path))
    finally:
        reader.close()
    missing = sorted(set(rules.transform) - set(transformed))
    problems += [f"{p}: listed in transform but not exported" for p in missing]
    if problems:
        raise ExportError("export refused:\n  " + "\n  ".join(problems))

    overlay_entries = [
        (mode, sha, path)
        for mode, kind, sha, path in ls_tree(overlay, repo)
        if kind == "blob" and rules.is_overlay(path) and path != MANIFEST
    ]
    export_tree = make_tree(exported, repo)
    overlay_tree = make_tree(overlay_entries, repo)
    payload_tree = make_tree(exported + overlay_entries, repo)
    manifest = {
        "format": 1,
        "source": {"commit": src_commit, "tree": src_tree},
        "rules_sha256": rules.digest,
        "trees": {"export": export_tree, "overlay": overlay_tree, "payload": payload_tree},
        "counts": {
            "exported": len(exported),
            "excluded": len(excluded),
            "replaced_by_overlay": len(replaced),
            "transformed": len(transformed),
        },
        "excluded_paths_sha256": hashlib.sha256("\n".join(sorted(excluded)).encode()).hexdigest(),
        "transformed": transformed,
    }
    blob = write_blob(manifest_bytes(manifest), repo)
    final_tree = make_tree(exported + overlay_entries + [("100644", blob, MANIFEST)], repo)
    return {"tree": final_tree, "manifest": manifest, "excluded": excluded, "replaced": replaced}


def tree_without(rev: str, repo: str, drop) -> str:
    entries = [(m, s, p) for m, k, s, p in ls_tree(rev, repo) if k == "blob" and not drop(p)]
    return make_tree(entries, repo)


def check_manifest(rev: str, repo: str) -> dict:
    manifest = json.loads(git("show", f"{rev}:{MANIFEST}", cwd=repo))
    rules = Rules(git("show", f"{rev}:{RULES}", cwd=repo))
    problems = []
    if manifest.get("rules_sha256") != rules.digest:
        problems.append("rules.json differs from the rules recorded in the manifest")
    payload = tree_without(rev, repo, lambda p: p == MANIFEST)
    export = tree_without(rev, repo, lambda p: p == MANIFEST or rules.is_overlay(p))
    if payload != manifest["trees"]["payload"]:
        problems.append(f"payload tree {payload} != manifest {manifest['trees']['payload']}")
    if export != manifest["trees"]["export"]:
        problems.append(f"export tree {export} != manifest {manifest['trees']['export']}")
    for path, ids in manifest.get("transformed", {}).items():
        actual = git("rev-parse", f"{rev}:{path}", cwd=repo).decode().strip()
        if actual != ids["export_blob"]:
            problems.append(f"{path}: blob {actual} != manifest {ids['export_blob']}")
    if problems:
        raise ExportError("manifest check failed:\n  " + "\n  ".join(problems))
    return manifest


def remote_slug(repo: str) -> str:
    url = git("remote", "get-url", "origin", cwd=repo).decode().strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+?)(?:\.git)?$", url)
    if not m:
        raise ExportError(f"origin of {repo} is not a GitHub repository")
    return m.group(1)


def gh_json(*args: str) -> object:
    proc = subprocess.run(["gh", *args], capture_output=True, check=False)
    if proc.returncode != 0:
        raise ExportError(f"gh {' '.join(args[:2])}: {proc.stderr.decode(errors='replace').strip()}")
    return json.loads(proc.stdout or b"null")


def cmd_sync(a, repo: str) -> None:
    if not a.branch.startswith("sync/"):
        raise ExportError("sync writes only sync/* branches; main changes through pull requests")
    if b"origin" in git("remote", cwd=repo).split():
        git("fetch", "-q", "origin", cwd=repo)
    elif a.push or a.pr:
        raise ExportError("--push/--pr need an origin remote")
    overlay = a.overlay or "origin/main"
    parent = git("rev-parse", "--verify", a.parent or "origin/main", cwd=repo).decode().strip()
    result = build(a.source, a.rev, overlay, repo)
    m = result["manifest"]
    parent_tree = git("rev-parse", f"{parent}^{{tree}}", cwd=repo).decode().strip()
    same_payload = False
    try:
        same_payload = json.loads(git("show", f"{parent}:{MANIFEST}", cwd=repo))["trees"]["payload"] == m["trees"]["payload"]
    except ExportError:
        pass
    print(f"source {m['source']['commit']}  tree {result['tree']}  exported {m['counts']['exported']}")
    if result["tree"] == parent_tree or (same_payload and not a.force):
        print("no change against the parent (only excluded files changed); nothing to validate")
        return
    short = m["source"]["commit"][:12]
    message = (
        f"sync: source {short}\n\n"
        f"Source-Commit: {m['source']['commit']}\n"
        f"Source-Tree: {m['source']['tree']}\n"
        f"Export-Tree: {m['trees']['export']}\n"
        f"Rules-SHA256: {m['rules_sha256']}\n"
    )
    commit = git("commit-tree", result["tree"], "-p", parent, "-m", message, cwd=repo).decode().strip()
    git("update-ref", f"refs/heads/{a.branch}", commit, cwd=repo)
    print(f"commit {commit} on {a.branch}")
    if a.push:
        git("push", "--force", "origin", f"{commit}:refs/heads/{a.branch}", cwd=repo)
        print("pushed")
    if a.pr:
        slug = remote_slug(repo)
        existing = gh_json("pr", "list", "--repo", slug, "--head", a.branch, "--state", "open", "--json", "number")
        if not existing:
            body = (
                f"Automated validation of source `{m['source']['commit']}`.\n\n"
                f"- export tree `{m['trees']['export']}`\n- rules `{m['rules_sha256'][:16]}`\n"
                f"- files: {m['counts']['exported']} exported, {m['counts']['excluded']} excluded, "
                f"{m['counts']['transformed']} pseudonymised\n"
            )
            subprocess.run(
                ["gh", "pr", "create", "--repo", slug, "--base", "main", "--head", a.branch,
                 "--title", f"sync: source {short}", "--body", body],
                check=True,
            )


def cmd_verify(a, repo: str) -> bool:
    manifest = json.loads(git("show", f"{a.commit}:{MANIFEST}", cwd=repo))
    rev = a.rev or manifest["source"]["commit"]
    expected = build(a.source, rev, a.commit, repo)["tree"]
    actual = git("rev-parse", f"{a.commit}^{{tree}}", cwd=repo).decode().strip()
    ok = expected == actual
    print(f"source {rev}\npublic commit {a.commit}\nexpected tree {expected}\nactual tree   {actual}")
    print("MATCH" if ok else "MISMATCH")
    return ok


def cmd_gate(a, repo: str) -> bool:
    src_slug = remote_slug(a.source)
    pub_slug = remote_slug(repo)
    pr = gh_json("pr", "view", str(a.pr), "--repo", src_slug, "--json", "headRefOid,baseRefName,state,url")
    head = pr["headRefOid"]
    git("fetch", "-q", "origin", cwd=repo)
    git("fetch", "-q", "origin", cwd=a.source)
    print(f"source PR {pr['url']} ({pr['state']}) head {head}")
    refs = git("for-each-ref", "--format=%(objectname) %(refname)", "refs/remotes/origin/", cwd=repo).decode().split("\n")
    candidates = []
    for line in filter(None, refs):
        sha, ref = line.split(" ", 1)
        try:
            mf = json.loads(git("show", f"{sha}:{MANIFEST}", cwd=repo))
        except (ExportError, json.JSONDecodeError):
            continue
        if mf["source"]["commit"] == head:
            candidates.append((sha, ref))
    if not candidates:
        print(f"FAIL: no public commit validates source {head}. Run: sync --rev {head} --branch sync/pr-{a.pr} --push --pr")
        return False
    for sha, ref in candidates:
        runs = gh_json("api", f"repos/{pub_slug}/commits/{sha}/check-runs?per_page=100")["check_runs"]
        result = [r for r in runs if r["name"] == RESULT_CHECK]
        latest = max(result, key=lambda r: r["started_at"] or "", default=None)
        status = f"{latest['status']}/{latest['conclusion']}" if latest else "missing"
        print(f"public {ref} {sha[:12]}: {RESULT_CHECK} = {status}")
        if not latest or latest["conclusion"] != "success":
            continue
        ns = argparse.Namespace(commit=sha, rev=head, source=a.source)
        if not cmd_verify(ns, repo):
            continue
        print(f"PASS: source {head} validated by {latest['html_url']}")
        if a.post_status:
            gh_json(
                "api", f"repos/{src_slug}/statuses/{head}", "-f", "state=success",
                "-f", "context=public-ci/validated", "-f", f"target_url={latest['html_url']}",
                "-f", f"description=tree {git('rev-parse', f'{sha}^{{tree}}', cwd=repo).decode().strip()[:12]} verified",
            )
            print("commit status posted on the source head")
        print("The merge itself stays a manual decision in the source repository.")
        return True
    print("FAIL: no successful and tree-verified public CI result for this source head")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("check-manifest")
    p.add_argument("--rev", default="HEAD")
    p = sub.add_parser("build")
    p.add_argument("--source", required=True)
    p.add_argument("--rev", required=True)
    p.add_argument("--overlay", default="HEAD")
    p.add_argument("--list", action="store_true", help="print excluded and replaced paths")
    p = sub.add_parser("sync")
    p.add_argument("--source", required=True)
    p.add_argument("--rev", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--overlay")
    p.add_argument("--parent")
    p.add_argument("--force", action="store_true", help="commit even if only the manifest changes")
    p.add_argument("--push", action="store_true")
    p.add_argument("--pr", action="store_true")
    p = sub.add_parser("verify")
    p.add_argument("--source", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--rev")
    p = sub.add_parser("gate")
    p.add_argument("--source", required=True)
    p.add_argument("--pr", required=True, type=int)
    p.add_argument("--post-status", action="store_true")
    a = parser.parse_args()
    repo = os.getcwd()
    try:
        if a.cmd == "check-manifest":
            m = check_manifest(a.rev, repo)
            print(f"manifest OK: source {m['source']['commit']} export {m['trees']['export']} rules {m['rules_sha256'][:16]}")
            summary = os.environ.get("GITHUB_STEP_SUMMARY")
            if summary:
                with open(summary, "a", encoding="utf-8") as fh:
                    fh.write(
                        "### Source\n\n| | |\n|---|---|\n"
                        f"| Source commit | `{m['source']['commit']}` |\n| Source tree | `{m['source']['tree']}` |\n"
                        f"| Export tree | `{m['trees']['export']}` |\n| Payload tree | `{m['trees']['payload']}` |\n"
                        f"| Rules SHA-256 | `{m['rules_sha256']}` |\n"
                    )
        elif a.cmd == "build":
            r = build(a.source, a.rev, a.overlay, repo)
            print(json.dumps({"tree": r["tree"], **r["manifest"]}, indent=2, ensure_ascii=False))
            if a.list:
                print("\n".join(["# excluded"] + r["excluded"] + ["# replaced by overlay"] + r["replaced"]))
        elif a.cmd == "sync":
            cmd_sync(a, repo)
        elif a.cmd == "verify":
            return 0 if cmd_verify(a, repo) else 1
        elif a.cmd == "gate":
            return 0 if cmd_gate(a, repo) else 1
    except ExportError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
