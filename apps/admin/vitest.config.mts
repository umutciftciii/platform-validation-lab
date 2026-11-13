import { defineConfig } from "vitest/config";

// Unit tests: the server-side API proxy (lib/api-proxy.ts), the console's session lookup, route
// guard and shell model, and server-rendered dashboard widgets. No network, no Next server.
export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
