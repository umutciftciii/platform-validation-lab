/**
 * Staff authentication contracts (F1-002 Group 2, DP-011; design 11.2). Request bodies are strict
 * (unknown keys are refused); responses are what the API returns and what the admin app reads.
 * Single-use tokens travel in JSON bodies only, never in a URL path or query (NT-K4).
 */
import { z } from "zod";
import {
  CredentialTokenSchema,
  PasswordSchema,
  RecoveryCodeSchema,
  TotpCodeSchema,
  UuidSchema,
} from "./common.js";

/** Cookie names of the admin app (design 5.1). Host-only, Secure, HttpOnly, SameSite=Strict. */
export const ADMIN_SESSION_COOKIE = "__Host-dp_admin_session";
export const ADMIN_CHALLENGE_COOKIE = "__Host-dp_admin_challenge";
/** Cookie names of the public sites (DP-039). Listed so the proxies can tell them apart. */
export const MEMBER_SESSION_COOKIE = "__Host-dp_member_session";
export const MEMBER_CHALLENGE_COOKIE = "__Host-dp_member_challenge";

// --- login ---------------------------------------------------------------------------------

export const StaffLoginResponseSchema = z.strictObject({ next: z.literal("mfa") });
export type StaffLoginResponse = z.infer<typeof StaffLoginResponseSchema>;

/**
 * Second login step and step-up. Exactly one of a TOTP code or a recovery code. The step-up
 * accepts the shape but refuses a recovery code with 401 AUTH_MFA_INVALID (design 4.2, NT-M4).
 */
export const StaffMfaRequestSchema = z.union([
  z.strictObject({ code: TotpCodeSchema }),
  z.strictObject({ recoveryCode: RecoveryCodeSchema }),
]);
export type StaffMfaRequest = z.infer<typeof StaffMfaRequestSchema>;

// --- session -------------------------------------------------------------------------------

const IsoDate = z.iso.datetime({ offset: true });

export const StaffSessionResponseSchema = z.strictObject({
  user: z.strictObject({
    id: UuidSchema,
    email: z.string().max(320),
    displayName: z.string().max(200).nullable(),
  }),
  mfaVerifiedAt: IsoDate.nullable(),
  stepUpValidUntil: IsoDate.nullable(),
  idleExpiresAt: IsoDate,
  absoluteExpiresAt: IsoDate,
  /** DP-110 (ADR-018): the signed-in user is the system owner; shows the owner console. */
  isSystemOwner: z.boolean().optional(),
});
export type StaffSessionResponse = z.infer<typeof StaffSessionResponseSchema>;

export const StaffSessionListResponseSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: UuidSchema,
        createdAt: IsoDate,
        lastSeenAt: IsoDate,
        ipPrefix: z.string().max(45).nullable(),
        userAgent: z.string().max(256).nullable(),
        current: z.boolean(),
      }),
    )
    .max(50),
});
export type StaffSessionListResponse = z.infer<typeof StaffSessionListResponseSchema>;

// --- passwords and recovery codes ----------------------------------------------------------

export const StaffPasswordChangeRequestSchema = z.strictObject({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});
export type StaffPasswordChangeRequest = z.infer<typeof StaffPasswordChangeRequestSchema>;

/**
 * Password reset with an operator link (`iam-cli reset-link`). A TOTP code or a recovery code is
 * required (design 7, D9); a request without either is refused with 401 AUTH_MFA_INVALID.
 */
export const StaffPasswordResetRequestSchema = z.strictObject({
  token: CredentialTokenSchema,
  newPassword: PasswordSchema,
  code: TotpCodeSchema.optional(),
  recoveryCode: RecoveryCodeSchema.optional(),
});
export type StaffPasswordResetRequest = z.infer<typeof StaffPasswordResetRequestSchema>;

export const RecoveryCodesResponseSchema = z.strictObject({
  codes: z.array(z.string().regex(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)).length(10),
});
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponseSchema>;

// --- enrolment (activation, invitation, MFA re-enrolment, operator recovery) ---------------

export const EnrolTokenRequestSchema = z.strictObject({ token: CredentialTokenSchema });
export type EnrolTokenRequest = z.infer<typeof EnrolTokenRequestSchema>;

export const ENROL_STEPS = ["password", "current_password", "mfa"] as const;
export const EnrolStepSchema = z.enum(ENROL_STEPS);

/**
 * What the link is for, in words the page can show (DP-114). It tells the link holder nothing the
 * link did not already say: activation of the first administrator, an invitation, a recovery by
 * the operator (also the system owner's), or an MFA re-enrolment after an administrator's reset.
 */
export const ENROL_KINDS = ["activation", "invitation", "recovery", "mfa_reenrolment"] as const;
export const EnrolKindSchema = z.enum(ENROL_KINDS);
export type EnrolKind = z.infer<typeof EnrolKindSchema>;

export const EnrolInspectResponseSchema = z.strictObject({
  kind: EnrolKindSchema,
  emailMasked: z.string().max(320),
  /** When the link stops working (30 minutes for operator links, 24 hours for invitations). */
  expiresAt: IsoDate,
  steps: z.array(z.strictObject({ step: EnrolStepSchema, done: z.boolean() })).max(3),
});
export type EnrolInspectResponse = z.infer<typeof EnrolInspectResponseSchema>;

/** New password (activation, invitation, recovery) or the current one (MFA re-enrolment). */
export const EnrolPasswordRequestSchema = z.union([
  z.strictObject({ token: CredentialTokenSchema, password: PasswordSchema }),
  z.strictObject({ token: CredentialTokenSchema, currentPassword: PasswordSchema }),
]);
export type EnrolPasswordRequest = z.infer<typeof EnrolPasswordRequestSchema>;

export const EnrolMfaSetupResponseSchema = z.strictObject({
  otpauthUri: z.string().startsWith("otpauth://totp/").max(1000),
  secret: z.string().regex(/^[A-Z2-7]{32}$/),
});
export type EnrolMfaSetupResponse = z.infer<typeof EnrolMfaSetupResponseSchema>;

export const EnrolMfaConfirmRequestSchema = z.strictObject({
  token: CredentialTokenSchema,
  code: TotpCodeSchema,
});
export type EnrolMfaConfirmRequest = z.infer<typeof EnrolMfaConfirmRequestSchema>;

export const EnrolMfaConfirmResponseSchema = z.strictObject({
  recoveryCodes: RecoveryCodesResponseSchema.shape.codes,
});
export type EnrolMfaConfirmResponse = z.infer<typeof EnrolMfaConfirmResponseSchema>;
