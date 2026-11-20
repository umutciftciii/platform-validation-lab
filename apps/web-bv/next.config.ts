import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // DP-084: no persistent Turbopack dev cache, see apps/admin/next.config.ts (next dev 16.4
    // reload loop, vercel/next.js#100267). Dev only.
    turbopackFileSystemCacheForDev: false,
    // DP-176: dev only, as in apps/admin (DP-181). With the default (true), `next dev` 16.4.5 keeps
    // the React debug channel of every HTML response in a module-level map until a browser opens
    // the HMR socket for that response (server/dev/debug-channel.js; upstream TODO: "clean up after
    // a timeout ... when CURL'ing the page"). Requests without a browser (smoke, readiness, redirect
    // and SEO checks, crawlers) never connect, so each one stayed in memory for good: measured
    // ~0.2-0.5 MiB per page render, never returned when idle (600 × 404: +136 MiB external, +84 MiB
    // after idle), which pushed DEV web-bv to its 2304m limit over repeated checks. With false the
    // debug info is sent inline in the RSC payload; production builds never use the channel.
    // Remove once a Next release cleans the map up (DP-115).
    reactDebugChannel: false,
    // ML-3 (DP-236): the root layouts are per language (`app/[locale]`) and for previews
    // (`app/(preview)`); an address no route matches gets `app/global-not-found.tsx`.
    globalNotFound: true,
  },
  // CMS S2 (DP-134): the home page is filled from the CMS. The former review routes of the
  // prototype rendered the same content from code; they point at the real page instead, so the
  // content has one source. Temporary: no browser caches the redirect. ML-3: the home is `/en`
  // (one hop; `/` itself answers 301 to `/en` in proxy.ts).
  redirects() {
    return [{ source: "/demo/:path*", destination: "/en", permanent: false }];
  },
  // Preview links carry a signed token: never cached, never sent on as a referrer.
  headers() {
    return [
      {
        source: "/preview/:token",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      // DP-173: the company catalogue preview (list, categories, products, images).
      {
        source: "/preview/catalog/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
