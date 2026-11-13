# @dream/api

NestJS modular monolith + Prisma 7 (PostgreSQL, `@prisma/adapter-pg`). Since F1-002 Group 2 it
serves staff authentication and staff administration behind the per-app proxy key.

| Endpoint              | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `GET /health`         | Liveness, no DB access, no key                                                 |
| `GET /health/ready`   | Readiness: database, mode and a least-privileged role; 503 otherwise           |
| `GET /health/metrics` | Proxy-key counters per app and slot (no values); private network only          |
| `/api/v1/*`           | Only with a known `X-DP-Proxy-Key`; otherwise 404 (see "Staff authentication") |

Start-up goes through `createApiApp` (`src/app.factory.ts`). The configuration is validated first:
proxy keys, IAM secrets and TLS. A missing or weak value stops the API with a message that names
the variable, never its value.

Generated client: `src/generated/prisma` (git-ignored, built by `prisma generate`).

## IAM (F1-001, ADR-011)

`src/iam/` holds the identity and authorization foundation, the authentication building blocks
(F1-002 Group 1) and the staff authentication endpoints (F1-002 Group 2).

| File                | What                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.ts`        | Sites, modules, permissions, roles: source of truth                                                                                                                                                                                         |
| `authorization.ts`  | `decide` (deny by default), `heldPermissions`, `accessibleScope`                                                                                                                                                                            |
| `escalation.ts`     | `canAssignRole` / `canRevokeRole`: no self-grant, no escalation                                                                                                                                                                             |
| `site-scope.ts`     | `withSiteScope`: Prisma extension that enforces the site boundary                                                                                                                                                                           |
| `modules.ts`        | God Mode rule: core modules cannot be disabled                                                                                                                                                                                              |
| `session-policy.ts` | Separate staff and customer session policies                                                                                                                                                                                                |
| `audit.ts`          | Audit event validation and metadata masking                                                                                                                                                                                                 |
| `catalog-sync.ts`   | Mirrors the catalogue into the database (idempotent)                                                                                                                                                                                        |
| `bootstrap.ts`      | One-time, password-less bootstrap of the first platform administrator                                                                                                                                                                       |
| `iam-cli.js` (dist) | `matrix`, `sync` (MIGRATE_DATABASE_URL, dp_migrator), `bootstrap` (IAM_BOOTSTRAP_DATABASE_URL, dp_iam_bootstrap), `enrol-link`, `reset-link`, `recover-admin`, `cleanup` (DATABASE_URL, dp_app); DB commands need `--confirm-database <db>` |
| `operator.ts`       | The CLI's link and recovery commands (`docs/security/operator-recovery.md`)                                                                                                                                                                 |
| `repository.ts`     | Loads authorization snapshots, act targets and administrator counts                                                                                                                                                                         |

### Authentication foundation (F1-002 Group 1, ADR-013)

The building blocks below are used by the Group 2 endpoints.

| File                         | What                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `escalation.ts`              | `canActOnUser`: target superiority, self, ancestry, terminal state, last administrator (design 10.3/10.5) |
| `auth/password.ts`           | Argon2id (19 MiB, t=2, p=1), re-hash check, at most 4 hashes at once, NFKC, password policy               |
| `auth/breached-passwords.ts` | Embedded breached list (SecLists top 100k, pinned; `data/breached-passwords/SOURCE.md`)                   |
| `auth/totp.ts`               | RFC 6238 TOTP (SHA-1, 6 digits, ±1 step) with replay step, base32, otpauth URI                            |
| `auth/secret-box.ts`         | AES-256-GCM with a versioned keyring (`IAM_MFA_ENC_KEYS`), AAD `userId\|factorId`                         |
| `auth/hmac.ts`, `tokens.ts`  | Domain-separated HMAC (`IAM_HMAC_KEY`); 256-bit tokens (SHA-256 stored); Crockford recovery codes         |
| `auth/throttle.ts`           | `AuthThrottle` progressive delay (no lockout), `throttledVerify` order                                    |
| `auth/cleanup.ts`            | Retention clean-up (`AUTH_RETENTION`), advisory-locked; run by `AuthCleanupService`                       |
| `auth/secrets.ts`            | Validates the authentication secrets; called at start-up through `loadApiConfig`                          |

Error envelope and shared Zod request types: `@dream/contracts` (`errors.ts`, `auth/common.ts`).

### Staff authentication (F1-002 Group 2, ADR-013)

**Trust boundary.** The order is:

1. Browser.
2. The admin Next app's Route Handler `app/api/[...path]` (`apps/admin/lib/api-proxy.ts`). It
   adds `X-DP-Proxy-Key`, `X-DP-Client-IP` and `X-DP-Request-Id` and strips everything else.
3. This API, running as `dp_app`.

The security middleware (`src/iam/http/security.middleware.ts`) runs before routing. It applies,
in order:

- the proxy key (unknown key: 404);
- the per-app path allowlist;
- CSRF: allowed `Origin` or `Sec-Fetch-Site: same-origin`, and a JSON body;
- no query string on state-changing requests;
- a body of at most 16 KB.

`Host`, `X-Forwarded-*` and `Forwarded` are never read. Express `trust proxy` is off.

| File                          | What                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `http/api-config.ts`          | Start-up configuration: proxy keys, IAM secrets, TLS, CSRF origins, admin base URL          |
| `http/proxy-keys.ts`          | Per-app keys with `current`/`next` slots, constant-time match, slot metrics                 |
| `http/security.middleware.ts` | Key, allowlist, CSRF, body limit, cookies of the app, client IP                             |
| `http/api-error.ts`           | Error envelope (design 11.1); unknown errors become a generic 500                           |
| `staff/sessions.ts`           | Opaque sessions: idle 30 min, absolute 8 h, at most 5, rotation, `securityVersion` check    |
| `staff/staff-auth.service.ts` | Login + MFA challenge, logout, step-up, devices, password change and reset, recovery codes  |
| `staff/enrolment.service.ts`  | Activation, invitation, MFA re-enrolment and operator recovery (one flow, four purposes)    |
| `staff/user-admin.service.ts` | Invite, enrolment link, MFA reset, suspend, reactivate, unlock, revoke sessions, deactivate |
| `staff/credentials.ts`        | Single-use tokens: issue, look up, count failures, consume                                  |

Routes are under `/api/v1/`. Bodies are JSON and validated with `@dream/contracts`; `204` has no
body.

| Method | Path                                     | Needs                                                                     |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `auth/staff/login`                       | throttle; sets the challenge cookie                                       |
| POST   | `auth/staff/login/mfa`                   | challenge; `{code}` or `{recoveryCode}`                                   |
| POST   | `auth/staff/logout`                      | –                                                                         |
| GET    | `auth/staff/session`                     | session                                                                   |
| POST   | `auth/staff/step-up`                     | session; TOTP only; rotates                                               |
| GET    | `auth/staff/sessions`                    | session                                                                   |
| DELETE | `auth/staff/sessions/{id}`               | own session, else 404                                                     |
| POST   | `auth/staff/sessions/revoke-others`      | step-up                                                                   |
| POST   | `auth/staff/password/change`             | step-up; rotates; other devices out                                       |
| POST   | `auth/staff/password/reset`              | reset link + TOTP or recovery code                                        |
| POST   | `auth/staff/mfa/recovery-codes`          | step-up                                                                   |
| POST   | `auth/staff/enrol/inspect`               | link token                                                                |
| POST   | `auth/staff/enrol/password`              | link token                                                                |
| POST   | `auth/staff/enrol/mfa/setup`             | link token, password step done                                            |
| POST   | `auth/staff/enrol/mfa/confirm`           | link token                                                                |
| POST   | `admin/users/invite`                     | `user:invite` @ site (+ `canAssignRole` for `roleKey`)                    |
| POST   | `admin/users/{id}/enrolment-link`        | `user:invite`, dominance, pending invitation                              |
| POST   | `admin/users/{id}/mfa-reset`             | `mfa:reset`, dominance                                                    |
| POST   | `admin/users/{id}/suspend`, `reactivate` | `user:suspend` / `user:reactivate`; `siteId` = membership, none = account |
| POST   | `admin/users/{id}/unlock`                | `user:unlock`                                                             |
| POST   | `admin/users/{id}/sessions/revoke`       | `session:revoke` (super admin only)                                       |
| POST   | `admin/users/{id}/deactivate`            | `user:deactivate` @ platform, `confirmEmail`                              |

Every `admin/*` call needs a fresh step-up (10 minutes). After that come `canActOnUser`
(design 10.3) and an audit event, written on success and on refusal.

**Environment.** See also `.env.example` and `infra/docker/compose*.yaml`.

| Variable                                                            | Required           | Notes                                                                 |
| ------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `DP_PROXY_KEY_ADMIN`, `_WEB_BV`, `_WEB_CORPORATE`                   | yes                | ≥ 43 base64url characters, all different; optional `<NAME>_NEXT` slot |
| `IAM_MFA_ENC_KEYS`                                                  | yes                | `<version>:<32-byte base64url key>[,…]`                               |
| `IAM_HMAC_KEY`                                                      | yes                | ≥ 32 bytes base64url, different from every MFA key                    |
| `DP_DEPLOY_ENV`                                                     | no                 | `local` (default), `staging`, `production`                            |
| `DP_API_REQUIRE_TLS`, `DP_API_TLS_CERT_FILE`, `DP_API_TLS_KEY_FILE` | staging/production | HTTPS only; plain HTTP refused at start-up                            |
| `DP_ALLOWED_ORIGINS_ADMIN` (`_WEB_BV`, `_WEB_CORPORATE`)            | no                 | CSRF origins; default the production hosts                            |
| `DP_ADMIN_BASE_URL`                                                 | no                 | origin for links; default `https://admin.dreampetroleum.com`          |
| `IAM_CLEANUP_INTERVAL_MINUTES`                                      | no                 | default 15; 0 turns the in-process clean-up off                       |

Runbooks: `docs/security/proxy-key-rotation.md` and `docs/security/operator-recovery.md`.

**Tests.**

- `test/unit/iam/http/boundary.test.ts`: configuration, keys, CSRF and the static guarantees.
- `test/integration/staff-auth.int.test.ts`: the end-to-end scenario and the negative tests, over
  HTTP and the CLI, on an empty database of its own (`AUTH_*_DATABASE_URL`).
- `apps/admin/test/api-proxy.test.ts`: the Route Handler contract.

```bash
pnpm --filter @dream/api run iam:matrix   # print the permission matrix (no database)
```

The matrix document `docs/security/rbac-matrix.md` is generated; a unit test fails if it is stale.

## Database roles (ADR-012A)

The API connects as `dp_app` (`DATABASE_URL`): data access only, no DDL, read-only IAM catalogue,
append-only audit. Migrations and `iam:sync` connect as `dp_migrator` (`MIGRATE_DATABASE_URL`),
which acts as the schema owner `dp_owner`; `prisma.config.ts` reads only that variable. The
bootstrap uses its own `dp_iam_bootstrap` credential, never given to the API. `/health/ready`
answers 503 if the API is connected with a privileged role. Matrix and operations:
`docs/security/db-roles.md`.
