# @dream/web-corporate

dreampetroleum.com (contract 3.2: Turkish and English). Since COM-1 every page carries its language
(`/en/…`, `/tr/…`) and is read from the shared CMS with this site's own proxy key:

- `app/[locale]/[slug]` — CMS content pages (published revision, corporate navigation and footer);
- `app/[locale]/privacy` — the published privacy policy of the language (DP-095/DP-298);
- `app/[locale]` — the home page, the designed page `corporate.home` (COM-2b; 404 while it is not
  published in the language);
- `app/[locale]/products` — the product portfolio, the designed page `corporate.products` at
  `/products` (COM-2b: anchored groups, COA request; not the BV catalogue);
- `app/(preview)/preview/[token]` — a signed admin preview of a draft (DP-321; noindex, no-store);
- `proxy.ts` + `lib/proxy-routes.ts` — language prefix, real 404s, redirects (Admin > SEO >
  Redirects), trailing slash;
- `app/sitemap.ts`, `app/robots.ts`, `lib/seo.ts` — canonical, hreflang, Open Graph, sitemap.

Design (COM-2a): Tailwind 4 with the tokens in `app/globals.css` (navy `#0a1f44`, blue `#2e5aa7`,
amber `#faae36` only as an accent, Inter Tight + Manrope via `next/font`), the header and phone menu
(`components/site-header.tsx`, state rules in `lib/menu-state.ts`), the footer and frame
(`components/site-frame.tsx`) and the eight standard section types
(`components/template-sections.tsx`); COM-2b the home page and portfolio
(`components/home-page.tsx`, `components/products-page.tsx`; fields in contracts
`cms-corporate.ts`). Images: only registered files of this site
(`CMS_STATIC_ASSETS` with `site: "CORPORATE"`, served from `public/media/`); none are registered
until their rights are confirmed (DP-320), and every section is laid out without one.

Environment: `DP_API_URL`, `DP_PROXY_KEY_WEB_CORPORATE`, `DP_DEPLOY_ENV`,
`DP_PUBLIC_ORIGIN_CORPORATE` (default `http://localhost:3111` locally), `DP_SEO_INDEXING`.
Health: `GET /api/health`. Unit tests: `pnpm --filter @dream/web-corporate test`.
