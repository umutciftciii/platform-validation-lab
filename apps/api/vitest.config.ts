import { defineConfig } from "vitest/config";

// Unit tests: no database, no network. `pnpm --filter @dream/api test`.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
  },
});
