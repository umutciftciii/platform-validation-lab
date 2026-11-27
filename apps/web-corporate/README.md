# @dream/web-corporate

dreampetroleum.com (contract 3.2: Turkish and English). Since COM-1 every page carries its language
(`/en/…`, `/tr/…`) and is read from the shared CMS with this site's own proxy key:

- `app/[locale]/[slug]` — CMS content pages (published revision, corporate navigation and footer);
- `app/[locale]/privacy` — the published privacy policy of the language (DP-095/DP-298);
- `app/[locale]` — the home (a notice until its designed page, COM-2);
- `proxy.ts` + `lib/proxy-routes.ts` — language prefix, real 404s, redirects (Admin > SEO >
  Redirects), trailing slash;
- `app/sitemap.ts`, `app/robots.ts`, `lib/seo.ts` — canonical, hreflang, Open Graph, sitemap.

Environment: `DP_API_URL`, `DP_PROXY_KEY_WEB_CORPORATE`, `DP_DEPLOY_ENV`,
`DP_PUBLIC_ORIGIN_CORPORATE` (default `http://localhost:3111` locally), `DP_SEO_INDEXING`.
Health: `GET /api/health`. Unit tests: `pnpm --filter @dream/web-corporate test`.
