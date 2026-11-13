# @dream/admin

Next.js admin app. Health: `GET /api/health`.

## Console (DP-U, first phase)

Design foundation and app shell: anthracite sidebar (icon rail on tablets, drawer on phones),
top bar, light/dark/system theme, the overview dashboard and staff sign-in (password + TOTP or
recovery code). Tailwind CSS 4; tokens in `app/globals.css`.

- **Access:** `proxy.ts` redirects to `/login` when the `__Host-dp_admin_session` cookie is
  missing. Every protected layout and page then calls `requireStaffSession()`
  (`lib/server-session.ts`), which asks the API's `GET /api/v1/auth/staff/session` through
  `proxyRequest`; anything but a valid session redirects to `/login`, an unreachable API shows
  the error state. The console holds no secret of its own and makes no RBAC decision; the API
  authorises every action.
- **Sample data:** everything on the overview except "Your session" comes from
  `lib/demo-data.ts` (`demo: true`) and carries the amber "Sample data" marker. Modules other than
  the overview render an empty state until they are built.

## API proxy (F1-002 Group 2, ADR-013 D2)

`app/api/[...path]/route.ts` forwards `/api/v1/auth/staff/*` and `/api/v1/admin/*` to the API.
Everything else answers 404 here. The contract is in `lib/api-proxy.ts` (design 2.4):

- Headers: client `X-DP-*`, `X-Forwarded-*`, `Forwarded` and the rest are dropped. Only `Origin`,
  `Sec-Fetch-Site`, `Content-Type`, `Accept`, `User-Agent` and `Accept-Language` pass. The proxy
  adds `X-DP-Proxy-Key`, `X-DP-Client-IP` and `X-DP-Request-Id`.
- Cookies: only `__Host-dp_admin_session` and `__Host-dp_admin_challenge`, in both directions.
- Bodies: POST only as JSON, at most 16 KB (otherwise 415 / 413). `Cache-Control: no-store`. A
  10 s timeout. An unreachable API gives a generic 502.
- Logs: never a body, cookie or key.

| Variable                | Notes                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `DP_API_URL`            | API origin. Must be https outside local development; a private CA comes through `NODE_EXTRA_CA_CERTS`. |
| `DP_PROXY_KEY_ADMIN`    | The admin key only. Server-side; never a `NEXT_PUBLIC_` variable.                                      |
| `DP_TRUSTED_PROXY_HOPS` | `X-Forwarded-For` entries the hosting edge appends (0 locally: no client IP sent).                     |
| `DP_DEPLOY_ENV`         | `local` (default), `staging`, `production`                                                             |

Tests: `pnpm --filter @dream/admin test`. CI also builds the app with a canary key and runs
`scripts/scan-build-for-secrets.mjs` (NT-P11).
