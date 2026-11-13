import { defineConfig } from "prisma/config";

// Migrate commands connect as the migration runner (ADR-012A): MIGRATE_DATABASE_URL, the
// dp_migrator role, whose sessions act as dp_owner. There is deliberately no fallback to
// DATABASE_URL: that is the API's least-privileged dp_app role, which cannot run DDL, so a
// missing MIGRATE_DATABASE_URL must fail instead of silently trying another identity.
// `prisma generate` and `prisma validate` need no URL.
// SHADOW_DATABASE_URL is set only by the test runner and CI for the drift check
// (`pnpm --filter @dream/api db:drift`). Prisma resets the shadow database, so it must be a
// dedicated *_test database, never an application database (ADR-010).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["MIGRATE_DATABASE_URL"] ?? "",
    ...(process.env["SHADOW_DATABASE_URL"]
      ? { shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"] }
      : {}),
  },
});
