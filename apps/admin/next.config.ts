import type { NextConfig } from "next";
import {
  ALL_PATHS,
  CREDENTIAL_LINK_HEADERS,
  CREDENTIAL_LINK_PATHS,
  FRAME_PROTECTION_HEADERS,
} from "./lib/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@dream/ui"],
  poweredByHeader: false,
  // Clickjacking protection on every response (lib/security-headers.ts).
  async headers() {
    return [
      { source: ALL_PATHS, headers: [...FRAME_PROTECTION_HEADERS] },
      // DP-114: credential link pages send no Referer and are never cached.
      ...CREDENTIAL_LINK_PATHS.map((source) => ({ source, headers: [...CREDENTIAL_LINK_HEADERS] })),
    ];
  },
  // The dev-only Next.js badge sat on top of the sidebar's environment label.
  devIndicators: false,
  experimental: {
    // DP-084: `next dev` 16.4 can reload a page in an endless loop ("HMR hash mismatch") when the
    // persistent Turbopack dev cache is out of step with the code, e.g. after a branch switch while
    // the dev server was down (vercel/next.js#100267, fix pending in #100291). Dev only; `next build`
    // does not use this cache. Remove once a Next release carries the upstream fix.
    turbopackFileSystemCacheForDev: false,
    // DP-181: temporary, dev only. In `next dev` 16.4.5 this flag (default true) sends React's
    // debug info for each client navigation over the HMR WebSocket instead of inline in the RSC
    // payload. If that socket is down when the request is served, the debug data never arrives and
    // the navigation waits forever: two `?_rsc=` 200 responses, the URL stays (e.g. "Verifying…"
    // after MFA). With false the debug info stays in the RSC payload. Production builds never load
    // the debug channel, so `next build` output is unaffected. Remove once a Next release keeps
    // navigations working while the HMR socket is disconnected (see DP-181, DP-115).
    reactDebugChannel: false,
  },
  // Tailwind CSS 4 through the Turbopack loader, the same wiring as web-bv.
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
