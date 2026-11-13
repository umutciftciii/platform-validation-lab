# Migration fixtures (tests only)

Used by `tools/test/migration-safety-test.sh` against the disposable test database
(`dream_platform_test`, tmpfs, Compose project `dream-petroleum-platform-test`). They are mounted
in place of `apps/api/prisma/migrations` only inside that test project and are never applied to
the dev or local-prod databases. All of them are additive; none removes data.

| Set         | Purpose                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `ok`        | One table. Happy path: runner exits 0, then the API starts                                |
| `slow`      | Holds Prisma's advisory lock about 6 s; a second, concurrent runner waits, then no-ops    |
| `very-slow` | Holds the lock about 20 s, longer than Prisma's 10 s wait; the second runner fails        |
| `fail`      | The second migration fails on purpose; the runner exits non-zero, so the API never starts |
