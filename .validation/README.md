# Validation procedure

Run from a local clone of this repository; `--source` is a local clone of the source repository.
This repository and its workflows never hold a credential for the source repository.

1. Open the pull request in the source repository as usual.
2. Export its head and open a validation pull request here:

   ```bash
   python3 -I .validation/export.py sync --source ../source --rev <head-sha> \
     --branch sync/pr-<n> --push --pr
   ```

   If only excluded files changed, `sync` reports that there is nothing to validate.

3. Wait for the `CI result` check of that pull request.
4. Run the merge gate. It rebuilds the export of the source head locally, finds a public commit
   with exactly that content and a successful `CI result`, and prints PASS or FAIL. It never
   merges anything; `--post-status` adds a `public-ci/validated` commit status to the source head.

   ```bash
   python3 -I .validation/export.py gate --source ../source --pr <n>
   ```

5. Merge only with the gated merge command, never with the web "Merge" button:

   ```bash
   python3 -I .validation/export.py merge --source ../source --pr <n> --yes
   ```

   It runs the gate again, posts `public-ci/validated` on the source head and merges with
   `--match-head-commit`, so GitHub refuses the merge if the head is not the verified commit. A
   new push to the source pull request needs a new sync and a new PASS. (Free private
   repositories have no branch protection, so GitHub itself cannot block a manual merge; this
   command is the control.)

6. After the source merge, export the new source `main` to a `sync/main-<sha>` pull request and
   squash-merge it here once `CI result` passes. A tree that already passed is not tested again.
   Squash commits are authored with the GitHub account's commit e-mail; keep "Keep my email
   addresses private" enabled so that it is the noreply address.

`verify --commit <public-sha>` recomputes a public commit from the source and prints MATCH or
MISMATCH. The replacement table for pseudonymised files lives outside both repositories
(`~/.config/platform-validation-lab/private-rules.json`, mode 600).
