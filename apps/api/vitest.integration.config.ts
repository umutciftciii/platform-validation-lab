import { defineConfig } from "vitest/config";

// Integration tests against a disposable *_test database (see test/integration/api.int.test.ts).
// One file at a time: the tests share process.env and one database.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
