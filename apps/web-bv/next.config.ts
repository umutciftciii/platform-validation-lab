import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // DP-084: no persistent Turbopack dev cache, see apps/admin/next.config.ts (next dev 16.4
    // reload loop, vercel/next.js#100267). Dev only.
    turbopackFileSystemCacheForDev: false,
  },
  // CMS S2 (DP-134): the home page is "/" now, filled from the CMS. The former review routes of
  // the prototype rendered the same content from code; they point at the real page instead, so
  // the content has one source. Temporary: no browser caches the redirect.
  redirects() {
    return [{ source: "/demo/:path*", destination: "/", permanent: false }];
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
