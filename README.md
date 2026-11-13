# platform-validation-lab

Automated build, integration and compatibility checks.

This repository receives source snapshots only through `sync/*` pull requests. Each snapshot is
produced by [`.validation/export.py`](.validation/export.py) under the rules in
[`.validation/rules.json`](.validation/rules.json) and carries a manifest
(`.validation/source.json`) with the source commit, the exported tree ids and the rules digest.
The CI workflow (`.github/workflows/ci.yml`) checks the manifest on every run.

Changes are not accepted here directly; pull requests from other accounts are not merged.

All rights reserved. No license is granted for the contents of this repository.
