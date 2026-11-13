# @dream/smoke

- `node tools/smoke/check-ports.mjs`: port preflight (host sockets + `docker ps`).
- `node tools/smoke/smoke.mjs --report tools/smoke/output/smoke.json`: HTTP smoke test of the running stack.

No dependencies, runs on Node 20+.
