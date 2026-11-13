/**
 * Guard for every test that touches PostgreSQL: tests may only ever use a dedicated, disposable
 * test database. Dev and local-prod databases (ADR-009) must never receive test data.
 *
 * A URL is accepted only if all of these hold:
 *  - it is a postgres:// or postgresql:// URL;
 *  - the database name ends with "_test";
 *  - the database name is not one of the application databases (POSTGRES_DB, DEV_POSTGRES_DB from
 *    the environment, plus any names passed in);
 *  - the port is not 5440, the published port of the dev/local-prod application database.
 *
 * Errors never echo the URL, so a password in it cannot leak into test output.
 */
export const APP_DATABASE_PORT = 5440;

export interface TestDatabaseGuardOptions {
  /** Extra database names that must never be used by tests. */
  forbiddenDatabases?: readonly string[];
  /** Ports that serve application databases. Default: [5440]. */
  forbiddenPorts?: readonly number[];
  /** Environment to read POSTGRES_DB / DEV_POSTGRES_DB from. Default: process.env. */
  env?: Readonly<Record<string, string | undefined>>;
}

export class UnsafeTestDatabaseError extends Error {
  override name = "UnsafeTestDatabaseError";
}

export function assertTestDatabaseUrl(
  url: string | undefined,
  options: TestDatabaseGuardOptions = {},
): URL {
  const refuse = (reason: string): never => {
    throw new UnsafeTestDatabaseError(`Refusing to run tests against this database: ${reason}`);
  };
  if (!url) return refuse("no database URL is set (expected a *_test database)");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse("the database URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return refuse(`unsupported protocol "${parsed.protocol}"`);
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    return refuse(`database "${name}" is not a test database (name must end with "_test")`);
  }

  const env = options.env ?? process.env;
  const forbidden = new Set(
    [env["POSTGRES_DB"], env["DEV_POSTGRES_DB"], ...(options.forbiddenDatabases ?? [])].filter(
      (n): n is string => Boolean(n),
    ),
  );
  if (forbidden.has(name)) {
    return refuse(`database "${name}" is an application database`);
  }

  const port = Number(parsed.port || 5432);
  if ((options.forbiddenPorts ?? [APP_DATABASE_PORT]).includes(port)) {
    return refuse(`port ${port} serves the dev/local-prod application database`);
  }
  return parsed;
}
