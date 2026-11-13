/**
 * API error model (F1-002; ADR-013, design 11.1). Every error response has this body:
 *
 *   { "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "…", "requestId": "…", "details": [] } }
 *
 * `details` never echoes a submitted value: validation errors name the path and rule, password
 * policy errors name the rule. Authorization refusals (FORBIDDEN) never say why.
 */
import { z } from "zod";

/** Every error code with its HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  AUTH_TOKEN_INVALID: 400,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_MFA_INVALID: 401,
  AUTH_CHALLENGE_EXPIRED: 401,
  AUTH_SESSION_REQUIRED: 401,
  AUTH_STEP_UP_REQUIRED: 403,
  AUTH_REAUTH_REQUIRED: 403,
  AUTH_CSRF_REJECTED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT_LAST_ADMIN: 409,
  CONFLICT_STATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AUTH_PASSWORD_POLICY: 422,
  CONFIRMATION_MISMATCH: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  /** PM-2: the media storage is not configured or did not answer. */
  STORAGE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** Rules a new password can break (422 AUTH_PASSWORD_POLICY). */
export const PASSWORD_POLICY_DETAILS = [
  "too_short",
  "too_long",
  "breached",
  "contains_identity",
  "requires_change",
] as const;
export const PasswordPolicyDetailSchema = z.enum(PASSWORD_POLICY_DETAILS);
export type PasswordPolicyDetail = z.infer<typeof PasswordPolicyDetailSchema>;

/** A validation problem: where and which rule, never the value. */
export const ValidationDetailSchema = z.strictObject({
  path: z.string().max(200),
  rule: z.string().max(100),
});
export type ValidationDetail = z.infer<typeof ValidationDetailSchema>;

export const ErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().max(500),
    requestId: z.string().max(100),
    details: z.array(z.union([ValidationDetailSchema, PasswordPolicyDetailSchema])).max(50),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** Generic messages: specific enough for the UI, never revealing account state. */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "The request is invalid.",
  AUTH_TOKEN_INVALID: "This link is invalid or has expired.",
  AUTH_INVALID_CREDENTIALS: "The e-mail address or password is incorrect.",
  AUTH_MFA_INVALID: "The verification code is incorrect.",
  AUTH_CHALLENGE_EXPIRED: "The sign-in attempt has expired. Please sign in again.",
  AUTH_SESSION_REQUIRED: "Please sign in.",
  AUTH_STEP_UP_REQUIRED: "Please confirm with your authenticator code.",
  AUTH_REAUTH_REQUIRED: "Please confirm your password.",
  AUTH_CSRF_REJECTED: "The request was rejected.",
  FORBIDDEN: "You are not allowed to do this.",
  NOT_FOUND: "Not found.",
  CONFLICT_LAST_ADMIN: "The last platform administrator cannot be removed.",
  CONFLICT_STATE: "This action is not possible in the current state.",
  PAYLOAD_TOO_LARGE: "The request is too large.",
  UNSUPPORTED_MEDIA_TYPE: "The request must be JSON.",
  AUTH_PASSWORD_POLICY: "The password does not meet the policy.",
  CONFIRMATION_MISMATCH: "The confirmation does not match.",
  RATE_LIMITED: "Too many attempts. Please try again later.",
  INTERNAL_ERROR: "Something went wrong.",
  BAD_GATEWAY: "The service is unavailable.",
  STORAGE_UNAVAILABLE: "File storage is not available right now. Try again later.",
};

export function errorBody(
  code: ErrorCode,
  requestId: string,
  details: ErrorBody["error"]["details"] = [],
  message: string = DEFAULT_ERROR_MESSAGES[code],
): ErrorBody {
  return { error: { code, message, requestId, details } };
}

/** Zod issues to error details: path and rule only, the input value is dropped. */
export function validationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join(".").slice(0, 200) || "(root)",
    rule: issue.code,
  }));
}
