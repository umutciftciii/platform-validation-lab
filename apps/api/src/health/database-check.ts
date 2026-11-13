import type { HealthCheck } from "@dream/contracts";

/**
 * Readiness verdict for the database (ADR-009, ADR-012A). Kept free of Nest and Prisma so it can
 * be unit tested directly. `expected` is DB_EXPECTED_NAME; when set, any other database is "down".
 * `privileged` is true when the API's connection could change the schema or bypass the guards
 * (superuser, BYPASSRLS, CREATE on schema public, or owner of a table): the API must run as the
 * least-privileged dp_app role, so such a connection is "down" too (fail closed).
 */
export function evaluateDatabase(input: {
  env: string;
  expected?: string | undefined;
  actual?: string | undefined;
  reachable: boolean;
  privileged?: boolean | undefined;
}): HealthCheck {
  const { env, expected, actual = "", reachable, privileged = false } = input;
  if (!reachable) return { status: "down", detail: `env=${env} database unreachable` };
  if (expected && actual !== expected) {
    return { status: "down", detail: `env=${env} connected to an unexpected database` };
  }
  if (privileged) {
    return { status: "down", detail: `env=${env} connected with a privileged database role` };
  }
  return { status: "ok", detail: `env=${env} db=${actual}` };
}
