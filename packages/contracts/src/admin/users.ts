/**
 * Staff administration contracts (F1-002 Group 2, DP-011; design 11.3). Every endpoint needs an
 * admin session with a fresh step-up; the API checks the permission, target dominance
 * (`canActOnUser`) and the last-administrator rule. Links are returned once and never logged.
 */
import { z } from "zod";
import { AdminReasonSchema, EmailSchema, UuidSchema } from "../auth/common.js";

/**
 * Invite a staff user to a site. `roleKey` optionally assigns a role in the same transaction
 * (a SITE role at `siteId`, a PLATFORM role platform-wide), checked by `canAssignRole`.
 */
export const InviteUserRequestSchema = z.strictObject({
  email: EmailSchema,
  displayName: z.string().trim().min(1).max(200),
  siteId: UuidSchema,
  roleKey: z
    .string()
    .regex(/^[a-z][a-z_]{1,63}$/)
    .optional(),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

/** Absolute https link (http on a local development host) with the token in the fragment. */
const LinkSchema = z
  .string()
  .max(2000)
  .regex(
    /^https?:\/\/[^/#?]+\/enrol#t=[A-Za-z0-9_-]{43}$|^https?:\/\/[^/#?]+\/reset#t=[A-Za-z0-9_-]{43}$/,
  );

export const InviteUserResponseSchema = z.strictObject({
  userId: UuidSchema,
  enrolmentLink: LinkSchema,
});
export type InviteUserResponse = z.infer<typeof InviteUserResponseSchema>;

export const EnrolmentLinkResponseSchema = z.strictObject({ enrolmentLink: LinkSchema });
export type EnrolmentLinkResponse = z.infer<typeof EnrolmentLinkResponseSchema>;

export const MFA_RESET_VERIFICATION_METHODS = [
  "video_call",
  "in_person",
  "phone_callback",
  "manager_confirmation",
] as const;

export const MfaResetRequestSchema = z.strictObject({
  reason: AdminReasonSchema,
  verificationMethod: z.enum(MFA_RESET_VERIFICATION_METHODS),
});
export type MfaResetRequest = z.infer<typeof MfaResetRequestSchema>;

export const MfaResetResponseSchema = z.strictObject({ reenrolmentLink: LinkSchema });
export type MfaResetResponse = z.infer<typeof MfaResetResponseSchema>;

/** Suspend / reactivate: with `siteId` the membership on that site, without it the account. */
export const SuspendRequestSchema = z.strictObject({
  siteId: UuidSchema.optional(),
  reason: AdminReasonSchema,
});
export type SuspendRequest = z.infer<typeof SuspendRequestSchema>;

export const ReasonRequestSchema = z.strictObject({ reason: AdminReasonSchema });
export type ReasonRequest = z.infer<typeof ReasonRequestSchema>;

/** Deactivation is terminal; `confirmEmail` must equal the target's e-mail (design 10.5). */
export const DeactivateRequestSchema = z.strictObject({
  reason: AdminReasonSchema,
  confirmEmail: EmailSchema,
});
export type DeactivateRequest = z.infer<typeof DeactivateRequestSchema>;
