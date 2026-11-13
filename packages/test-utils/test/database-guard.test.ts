import { describe, expect, it } from "vitest";
import { UnsafeTestDatabaseError, assertTestDatabaseUrl } from "../src/database-guard.js";

const env = { POSTGRES_DB: "dream_platform", DEV_POSTGRES_DB: "dream_platform_dev" };
const url = (db: string, port = 5432) =>
  `postgresql://u:secret-pw@db.local:${port}/${db}?schema=public`;

describe("assertTestDatabaseUrl", () => {
  it("accepts a *_test database on a non-application port", () => {
    const parsed = assertTestDatabaseUrl(url("dream_platform_test"), { env });
    expect(parsed.pathname).toBe("/dream_platform_test");
  });

  it.each([
    ["missing URL", undefined],
    ["empty URL", ""],
    ["invalid URL", "not a url"],
    ["non-postgres protocol", "mysql://u:p@h:3306/x_test"],
    ["local-prod database", url("dream_platform")],
    ["dev database", url("dream_platform_dev")],
    ["name without _test suffix", url("dream_platform_testing")],
    ["test suffix in the middle", url("x_test_dev")],
    ["application port 5440", url("dream_platform_test", 5440)],
  ])("refuses %s", (_label, value) => {
    expect(() => assertTestDatabaseUrl(value, { env })).toThrow(UnsafeTestDatabaseError);
  });

  it("refuses a _test database that the environment names as an application database", () => {
    expect(() =>
      assertTestDatabaseUrl(url("odd_test"), { env: { ...env, DEV_POSTGRES_DB: "odd_test" } }),
    ).toThrow(/application database/);
  });

  it("refuses extra forbidden names and ports", () => {
    expect(() =>
      assertTestDatabaseUrl(url("a_test"), { env, forbiddenDatabases: ["a_test"] }),
    ).toThrow(/application database/);
    expect(() =>
      assertTestDatabaseUrl(url("a_test", 6000), { env, forbiddenPorts: [6000] }),
    ).toThrow(/port 6000/);
  });

  it("never echoes the password", () => {
    try {
      assertTestDatabaseUrl(url("dream_platform"), { env });
    } catch (error) {
      expect(String(error)).not.toContain("secret-pw");
      return;
    }
    throw new Error("expected a refusal");
  });
});
