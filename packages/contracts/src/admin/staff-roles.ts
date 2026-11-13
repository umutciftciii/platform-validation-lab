/**
 * Staff and role administration (DP-076 revision, DP-107; ADR-017 v2). A platform super admin
 * (or any holder of role_assignment:grant within its own permissions) assigns and revokes roles
 * directly: no second approver, no justification, no mandatory expiry. Changes take effect on the
 * next request and are audited (`iam.role_assigned`, `iam.role_revoked`).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });

export const ADMIN_STAFF_API = "/api/v1/admin/staff";
export const ADMIN_ROLE_ASSIGNMENTS_API = "/api/v1/admin/role-assignments";

export const RoleKeySchema = z.string().regex(/^[a-z][a-z_]{1,63}$/);

export const StaffSiteSchema = z.strictObject({
  id: UuidSchema,
  key: z.enum(["BV", "CORPORATE"]),
  name: z.string(),
});
export type StaffSite = z.infer<typeof StaffSiteSchema>;

export const StaffRoleAssignmentSchema = z.strictObject({
  id: UuidSchema,
  roleKey: z.string(),
  roleName: z.string(),
  scopeType: z.enum(["PLATFORM", "SITE"]),
  siteId: UuidSchema.nullable(),
  grantedAt: IsoDate,
  /** Null: permanent (the default). Older time-limited assignments keep their date. */
  expiresAt: IsoDate.nullable(),
  grantedBy: z.string().nullable(),
  /** The viewer may revoke it (scope, last-admin rule). */
  canRevoke: z.boolean(),
});
export type StaffRoleAssignment = z.infer<typeof StaffRoleAssignmentSchema>;

export const StaffMemberSchema = z.strictObject({
  id: UuidSchema,
  email: z.string(),
  displayName: z.string(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  mfaEnrolled: z.boolean(),
  memberships: z.array(
    z.strictObject({
      siteId: UuidSchema,
      status: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"]),
    }),
  ),
  roles: z.array(StaffRoleAssignmentSchema),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

export const AssignableRoleSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  scopeType: z.enum(["PLATFORM", "SITE"]),
  customerData: z.boolean(),
  /** Site ids where the viewer may assign it (PLATFORM roles: empty, see `platform`). */
  siteIds: z.array(UuidSchema),
  platform: z.boolean(),
});
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const StaffListResponseSchema = z.strictObject({
  staff: z.array(StaffMemberSchema),
  roles: z.array(AssignableRoleSchema),
  sites: z.array(StaffSiteSchema),
  viewerId: UuidSchema,
});
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;

/**
 * Assign a role. `siteId` for a site role (the user gets an ACTIVE membership there if they have
 * none or only an invitation), absent for a platform role. `expiresAt` is optional; omitted means
 * permanent. Assigning a role the user already holds in the same scope is refused, except that a
 * time-limited one is replaced (explicitly, audited) by the new assignment.
 */
export const AssignRoleRequestSchema = z.strictObject({
  roleKey: RoleKeySchema,
  siteId: UuidSchema.optional(),
  expiresAt: IsoDate.optional(),
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>;

export const AssignRoleResponseSchema = z.strictObject({
  assignment: StaffRoleAssignmentSchema,
  /** A time-limited assignment of the same role and scope that this one replaced. */
  replacedAssignmentId: UuidSchema.nullable(),
});
export type AssignRoleResponse = z.infer<typeof AssignRoleResponseSchema>;

/** Revoke a role assignment; the reason is optional (kept on the row and in the audit trail). */
export const RevokeRoleRequestSchema = z.strictObject({
  reason: z.string().trim().max(1000).optional(),
});
export type RevokeRoleRequest = z.infer<typeof RevokeRoleRequestSchema>;
