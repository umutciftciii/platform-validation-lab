// Integration tests: the compiled API (dist/) against a disposable *_test PostgreSQL database.
// Run through `infra/docker/stack.sh test integration` locally or the CI integration job; both
// provide DATABASE_URL for a throwaway database. The guard below aborts the whole file before
// anything connects if DATABASE_URL is not a test database (ADR-010).
import "reflect-metadata";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiTestEnv } from "./helpers/auth-env.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_DB_URL = process.env["DATABASE_URL"];
const testDb = assertTestDatabaseUrl(TEST_DB_URL);
const TEST_DB_NAME = testDb.pathname.slice(1);

interface RunningApi {
  base: string;
  close: () => Promise<void>;
}

// Each start builds a fresh Nest application through the production factory (proxy keys, IAM
// secrets and the security middleware, F1-002 Group 2); PrismaService reads DATABASE_URL when
// constructed.
async function startApi(env: Record<string, string>): Promise<RunningApi> {
  Object.assign(process.env, apiTestEnv(), env);
  const distModule = pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href;
  const { createApiApp } = (await import(distModule)) as {
    createApiApp: (o: { logger: false }) => Promise<{
      listen: (p: number, h: string) => Promise<unknown>;
      getHttpServer: () => { address: () => unknown };
      close: () => Promise<void>;
    }>;
  };
  const app = await createApiApp({ logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

async function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const databaseDetail = (body: Record<string, unknown>) =>
  (body["checks"] as { database?: { detail?: string } } | undefined)?.database?.detail;

describe("migrations on the test database", () => {
  it("prisma migrate deploy applies the committed migrations and reports none pending", () => {
    const prisma = path.join(API_DIR, "node_modules/.bin/prisma");
    const run = (args: string[]) =>
      execFileSync(prisma, args, {
        cwd: API_DIR,
        env: process.env,
        encoding: "utf8",
        stdio: "pipe",
      });
    expect(() => run(["migrate", "deploy"])).not.toThrow();
    expect(run(["migrate", "status"])).toMatch(/up to date|No migration found/i);
  });
});

describe("drift check (schema vs. migrations)", () => {
  // The CI gate runs `db:drift`; this proves it fails when the schema has a model that no
  // migration creates. Needs SHADOW_DATABASE_URL, which Prisma resets: guarded like DATABASE_URL.
  it("exits 2 for a schema change without a migration", () => {
    assertTestDatabaseUrl(process.env["SHADOW_DATABASE_URL"]);
    const dir = mkdtempSync(path.join(tmpdir(), "drift-"));
    const schema = path.join(dir, "schema.prisma");
    writeFileSync(
      schema,
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel DriftProbe {\n  id Int @id\n}\n',
    );
    const prisma = path.join(API_DIR, "node_modules/.bin/prisma");
    const result = spawnSync(
      prisma,
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema",
        schema,
        "--exit-code",
      ],
      { cwd: API_DIR, env: process.env, encoding: "utf8" },
    );
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/DriftProbe/);
  });
});

describe("API against the test database", () => {
  let api: RunningApi;
  beforeAll(async () => {
    api = await startApi({ DB_ENV: "test", DB_EXPECTED_NAME: TEST_DB_NAME });
  });
  afterAll(async () => {
    await api?.close();
  });

  it("answers liveness without touching the database", async () => {
    const { status, body } = await getJson(`${api.base}/health`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ service: "api", status: "ok" });
  });

  it("is ready and reports the test database", async () => {
    const { status, body } = await getJson(`${api.base}/health/ready`);
    expect(status).toBe(200);
    expect(databaseDetail(body)).toBe(`env=test db=${TEST_DB_NAME}`);
  });

  it("refuses readiness when it expects another database", async () => {
    process.env["DB_EXPECTED_NAME"] = `${TEST_DB_NAME}_other`;
    try {
      const { status, body } = await getJson(`${api.base}/health/ready`);
      expect(status).toBe(503);
      expect(databaseDetail(body)).toBe("env=test connected to an unexpected database");
    } finally {
      process.env["DB_EXPECTED_NAME"] = TEST_DB_NAME;
    }
  });
});

describe("API connected with a privileged database role (ADR-012A)", () => {
  // The API must run as dp_app. With the migrator (acts as dp_owner) or a superuser it could
  // disable the guard triggers, so readiness fails closed instead of serving.
  const privileged = [
    ["the migrator (dp_owner)", process.env["MIGRATE_DATABASE_URL"]],
    ["the test superuser", process.env["TEST_SUPERUSER_DATABASE_URL"]],
  ] as const;
  for (const [label, url] of privileged) {
    it(`refuses readiness when connected as ${label}`, async () => {
      const api = await startApi({
        DATABASE_URL: assertTestDatabaseUrl(url).toString(),
        DB_ENV: "test",
        DB_EXPECTED_NAME: TEST_DB_NAME,
      });
      try {
        expect((await getJson(`${api.base}/health`)).status).toBe(200);
        const { status, body } = await getJson(`${api.base}/health/ready`);
        expect(status).toBe(503);
        expect(databaseDetail(body)).toBe("env=test connected with a privileged database role");
      } finally {
        await api.close();
        process.env["DATABASE_URL"] = TEST_DB_URL;
      }
    });
  }
});

describe("API with the database unreachable", () => {
  let api: RunningApi;
  beforeAll(async () => {
    // Port 1 on loopback: nothing listens, so every query fails fast. Not a real database.
    api = await startApi({
      DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/unreachable_test",
      DB_ENV: "test",
      DB_EXPECTED_NAME: "unreachable_test",
    });
  });
  afterAll(async () => {
    await api?.close();
    process.env["DATABASE_URL"] = TEST_DB_URL;
  });

  it("keeps liveness up", async () => {
    expect((await getJson(`${api.base}/health`)).status).toBe(200);
  });

  it("reports 503 on readiness", async () => {
    const { status, body } = await getJson(`${api.base}/health/ready`);
    expect(status).toBe(503);
    expect(databaseDetail(body)).toBe("env=test database unreachable");
  });
});
