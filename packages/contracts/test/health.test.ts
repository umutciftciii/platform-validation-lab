import { describe, expect, it } from "vitest";
import { healthResponse } from "../src/health.js";

describe("healthResponse", () => {
  it("is ok without checks and omits the checks field", () => {
    const body = healthResponse("api", "1.2.3");
    expect(body).toMatchObject({ service: "api", status: "ok", version: "1.2.3" });
    expect(body).not.toHaveProperty("checks");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it("is down if any check is down, even next to degraded ones", () => {
    const body = healthResponse("api", "1", {
      a: { status: "ok" },
      b: { status: "degraded" },
      c: { status: "down" },
    });
    expect(body.status).toBe("down");
  });

  it("is degraded if the worst check is degraded", () => {
    expect(
      healthResponse("api", "1", { a: { status: "ok" }, b: { status: "degraded" } }).status,
    ).toBe("degraded");
  });

  it("is ok if every check is ok", () => {
    expect(healthResponse("admin", "1", { a: { status: "ok" } }).status).toBe("ok");
  });
});
