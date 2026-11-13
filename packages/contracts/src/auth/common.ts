/**
 * Shared authentication request types (F1-002; design 11). The API validates every request body
 * with these schemas and the Next apps use the same ones. Bodies are strict: unknown keys are
 * refused. Length rules beyond these structural limits (password policy) are checked by the API
 * and reported as 422 AUTH_PASSWORD_POLICY, not as a validation error.
 */
import { z } from "zod";

/** Normalised e-mail: trimmed, lower case, at most 320 characters. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email({ pattern: z.regexes.html5Email }));

/** Structural limit only; the policy (12/15..128 after NFKC) is checked by the API. */
export const PasswordSchema = z.string().min(1).max(1024);

/** Six-digit TOTP code. */
export const TotpCodeSchema = z.string().regex(/^\d{6}$/);

/** Recovery code as typed: Crockford base32, separators allowed (normalised by the API). */
export const RecoveryCodeSchema = z
  .string()
  .max(20)
  .regex(/^[0-9A-Za-z\s-]+$/);

/** Single-use token (256 bits, base64url). Accepted in a JSON body only, never in a URL. */
export const CredentialTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Free-text reason for an administrative action (audited). */
export const AdminReasonSchema = z.string().trim().min(10).max(1000);

export const UuidSchema = z.uuid();

/** Second login step: exactly one of a TOTP code or a recovery code. */
export const MfaAnswerSchema = z.union([
  z.strictObject({ code: TotpCodeSchema }),
  z.strictObject({ recoveryCode: RecoveryCodeSchema }),
]);
export type MfaAnswer = z.infer<typeof MfaAnswerSchema>;

export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: PasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
