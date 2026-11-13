import { describe, expect, it } from "vitest";
import {
  CredentialTokenSchema,
  DEFAULT_ERROR_MESSAGES,
  EmailSchema,
  ERROR_STATUS,
  ErrorBodySchema,
  LoginRequestSchema,
  MfaAnswerSchema,
  errorBody,
  validationDetails,
} from "../src/index.js";

describe("error model (design 11.1)", () => {
  it("maps every code to its HTTP status", () => {
    expect(ERROR_STATUS).toMatchObject({
      VALIDATION_FAILED: 400,
      AUTH_TOKEN_INVALID: 400,
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_STEP_UP_REQUIRED: 403,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT_LAST_ADMIN: 409,
      CONFLICT_STATE: 409,
      AUTH_PASSWORD_POLICY: 422,
      RATE_LIMITED: 429,
    });
    expect(Object.keys(DEFAULT_ERROR_MESSAGES).sort()).toEqual(Object.keys(ERROR_STATUS).sort());
  });

  it("builds bodies that match the schema", () => {
    const body = errorBody("AUTH_PASSWORD_POLICY", "req-1", ["too_short", "breached"]);
    expect(ErrorBodySchema.parse(body)).toEqual(body);
    expect(() => ErrorBodySchema.parse({ error: { ...body.error, code: "NOPE" } })).toThrow();
    expect(() => ErrorBodySchema.parse({ error: { ...body.error, extra: 1 } })).toThrow();
  });

  it("reports validation problems by path and rule, never by value", () => {
    const secret = "hunter2-very-secret-password";
    const r = LoginRequestSchema.safeParse({
      email: "not-an-email",
      password: secret,
      extra: secret,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const details = validationDetails(r.error);
    expect(details.length).toBeGreaterThan(0);
    expect(JSON.stringify(details)).not.toContain(secret);
    expect(JSON.stringify(details)).not.toContain("not-an-email");
    expect(
      ErrorBodySchema.parse(errorBody("VALIDATION_FAILED", "r", details)).error.details,
    ).toEqual(details);
  });
});

describe("shared auth schemas", () => {
  it("normalises e-mail and accepts one MFA answer kind", () => {
    expect(EmailSchema.parse("  Admin@Example.COM ")).toBe("admin@example.com");
    expect(MfaAnswerSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(MfaAnswerSchema.safeParse({ recoveryCode: "ABCDE-FGHJK" }).success).toBe(true);
    expect(MfaAnswerSchema.safeParse({ code: "123456", recoveryCode: "ABCDE-FGHJK" }).success).toBe(
      false,
    );
    expect(MfaAnswerSchema.safeParse({ code: "12345" }).success).toBe(false);
  });

  it("accepts only 256-bit base64url tokens", () => {
    expect(CredentialTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    expect(CredentialTokenSchema.safeParse("A".repeat(42)).success).toBe(false);
    expect(CredentialTokenSchema.safeParse("A".repeat(42) + "=").success).toBe(false);
  });
});
