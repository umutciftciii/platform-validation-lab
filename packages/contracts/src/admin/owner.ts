/**
 * System owner (God Mode) API (DP-108, ADR-018). Every `/api/v1/admin/owner/*` route answers 404 to
 * anyone but the designated system owner, so the area looks missing to other staff. The one
 * exception is the designation confirmation, which a staff user calls with the link token that
 * the operator CLI (`iam-cli owner-designate`) printed for exactly that user.
 *
 * - Module switches (owner decision K1, condition 4): only the owner enables or disables an
 *   optional module per site. A disabled module keeps its data (K-03), and its own functions stay
 *   closed for everyone, the owner included, until it is enabled again; the switch itself is
 *   always available to the owner. Core modules cannot be disabled.
 * - The PROTECTED audit stream (K2, K5, condition 2): the owner's actions and everything aimed at
 *   the owner account. It never shows on staff screens, it is never deleted, and it is chained
 *   with SHA-256; `verify` recomputes the chain.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });

export const OWNER_API = "/api/v1/admin/owner";

/** POST /api/v1/admin/owner/designation/confirm (session + fresh step-up + current password). */
export const OwnerDesignationConfirmRequestSchema = z.strictObject({
  /** The token from the link fragment (`#t=…`). */
  token: z.string().min(1).max(100),
  password: z.string().min(1).max(1024),
});
export type OwnerDesignationConfirmRequest = z.infer<typeof OwnerDesignationConfirmRequestSchema>;

export const OwnerDesignationConfirmResponseSchema = z.strictObject({
  designated: z.literal(true),
});
export type OwnerDesignationConfirmResponse = z.infer<typeof OwnerDesignationConfirmResponseSchema>;

export const OwnerSiteSchema = z.strictObject({
  id: UuidSchema,
  key: z.enum(["BV", "CORPORATE"]),
  name: z.string(),
});
export type OwnerSite = z.infer<typeof OwnerSiteSchema>;

export const OwnerModuleSiteStateSchema = z.strictObject({
  siteId: UuidSchema,
  enabled: z.boolean(),
  /** Reason of the last change; null when the module was never switched on this site. */
  reason: z.string().nullable(),
  updatedAt: IsoDate.nullable(),
});
export type OwnerModuleSiteState = z.infer<typeof OwnerModuleSiteStateSchema>;

export const OwnerModuleSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  /** Core modules are always on and cannot be switched. */
  isCore: z.boolean(),
  sites: z.array(OwnerModuleSiteStateSchema),
});
export type OwnerModule = z.infer<typeof OwnerModuleSchema>;

export const OwnerChainStatusSchema = z.strictObject({
  events: z.number().int().nonnegative(),
  intact: z.boolean(),
  firstBrokenSeq: z.number().int().nullable(),
  headSeq: z.number().int().nonnegative(),
  headHash: z.string().nullable(),
  checkedAt: IsoDate,
});
export type OwnerChainStatus = z.infer<typeof OwnerChainStatusSchema>;

export const OwnerOverviewResponseSchema = z.strictObject({
  owner: z.strictObject({
    id: UuidSchema,
    email: z.string(),
    displayName: z.string().nullable(),
    designatedAt: IsoDate,
  }),
  sites: z.array(OwnerSiteSchema),
  modules: z.array(OwnerModuleSchema),
  chain: OwnerChainStatusSchema,
});
export type OwnerOverviewResponse = z.infer<typeof OwnerOverviewResponseSchema>;

/** POST /api/v1/admin/owner/modules/:moduleKey/sites/:siteId (step-up; module:manage). */
export const OwnerModuleChangeRequestSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
});
export type OwnerModuleChangeRequest = z.infer<typeof OwnerModuleChangeRequestSchema>;

export const OwnerModuleChangeResponseSchema = z.strictObject({
  module: OwnerModuleSchema,
  changed: z.boolean(),
});
export type OwnerModuleChangeResponse = z.infer<typeof OwnerModuleChangeResponseSchema>;

export const ProtectedAuditEventSchema = z.strictObject({
  id: UuidSchema,
  chainSeq: z.number().int().positive(),
  occurredAt: IsoDate,
  actorType: z.enum(["USER", "SYSTEM", "BOOTSTRAP"]),
  actorUserId: UuidSchema.nullable(),
  /** Display name or e-mail of a USER actor; "System owner" for the owner. */
  actorLabel: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  scopeType: z.enum(["PLATFORM", "SITE"]),
  siteId: UuidSchema.nullable(),
  outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  rowHash: z.string().length(64),
});
export type ProtectedAuditEvent = z.infer<typeof ProtectedAuditEventSchema>;

/** GET /api/v1/admin/owner/audit?before=<chainSeq>&limit=<1..100> (step-up; owner_audit:read). */
export const ProtectedAuditListResponseSchema = z.strictObject({
  items: z.array(ProtectedAuditEventSchema).max(100),
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: z.number().int().positive().nullable(),
});
export type ProtectedAuditListResponse = z.infer<typeof ProtectedAuditListResponseSchema>;
