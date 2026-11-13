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
  // The prototype has no home page. Temporary, so browsers do not cache it and a
  // real home page can replace it by removing this entry.
  redirects() {
    return [
      {
        source: "/",
        destination: "/demo/iccsyn-hero-products",
        permanent: false,
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
