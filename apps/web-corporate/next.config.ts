import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // COM-1 (ML-4 rule): the trailing-slash 308 is answered by proxy.ts (`decideRequest`), so an old
  // address with a slash that redirects needs one hop, not 308 + 301.
  skipTrailingSlashRedirect: true,
  experimental: {
    // The root layouts are per language (`app/[locale]`); an address no route matches gets
    // `app/global-not-found.tsx` (as web-bv, ML-3).
    globalNotFound: true,
    // DP-084 / DP-176: dev only, as in web-bv and admin.
    turbopackFileSystemCacheForDev: false,
    reactDebugChannel: false,
  },
};

export default nextConfig;
