import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dream/ui"],
  experimental: {
    // DP-084: no persistent Turbopack dev cache, see apps/admin/next.config.ts (next dev 16.4
    // reload loop, vercel/next.js#100267). Dev only.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
