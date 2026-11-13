import { describe, expect, it } from "vitest";
import { evaluateDatabase } from "../../src/health/database-check.js";

describe("evaluateDatabase (readiness guard, ADR-009)", () => {
  it("is ok when connected to the expected database", () => {
    expect(
      evaluateDatabase({
        env: "prod",
        expected: "dream_platform",
        actual: "dream_platform",
        reachable: true,
      }),
    ).toEqual({ status: "ok", detail: "env=prod db=dream_platform" });
  });

  it("is down when connected to another mode's database", () => {
    const check = evaluateDatabase({
      env: "dev",
      expected: "dream_platform_dev",
      actual: "dream_platform",
      reachable: true,
    });
    expect(check.status).toBe("down");
    expect(check.detail).toBe("env=dev connected to an unexpected database");
    expect(check.detail).not.toContain("dream_platform");
  });

  it("is down when the database is unreachable", () => {
    expect(evaluateDatabase({ env: "test", expected: "x_test", reachable: false })).toEqual({
      status: "down",
      detail: "env=test database unreachable",
    });
  });

  it("does not compare names when no database is expected", () => {
    expect(evaluateDatabase({ env: "unset", actual: "anything", reachable: true }).status).toBe(
      "ok",
    );
  });

  it("is down when the API is connected with a privileged role (ADR-012A)", () => {
    expect(
      evaluateDatabase({
        env: "prod",
        expected: "dream_platform",
        actual: "dream_platform",
        reachable: true,
        privileged: true,
      }),
    ).toEqual({ status: "down", detail: "env=prod connected with a privileged database role" });
  });

  it("reports the wrong database before the privilege problem", () => {
    expect(
      evaluateDatabase({
        env: "dev",
        expected: "dream_platform_dev",
        actual: "dream_platform",
        reachable: true,
        privileged: true,
      }).detail,
    ).toBe("env=dev connected to an unexpected database");
  });
});
