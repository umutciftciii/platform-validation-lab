/**
 * Customer-data access sweep (DP-077; ADR-017 D6). Since the DP-076 revision (ADR-017 v2) no new
 * requests are created; the sweep only finishes the records of the legacy approved ones. Access itself ends at `expiresAt` without any
 * job: `decide` ignores expired grants. The sweep only keeps the records honest:
 *
 *  1. PENDING requests past `decideBy` become EXPIRED (they could no longer be approved anyway).
 *  2. Approved access whose `accessExpiresAt` has passed gets one `iam.customer_data_access_expired`
 *     audit event (unless it was revoked before), and `expiryRecordedAt` so it is recorded once.
 *
 * Runs as dp_app inside the API (CustomerDataAccessSweepService) and in tests directly. It never
 * deletes anything.
 */
import { writeAudit } from "../staff/audit-writer.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

export interface SweepResult {
  requestsExpired: number;
  accessExpired: number;
}

const BATCH = 200;

export async function runCustomerDataAccessSweep(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = { requestsExpired: 0, accessExpired: 0 };

  const stale = await db.customerDataAccessRequest.findMany({
    where: { status: "PENDING", decideBy: { lte: now } },
    select: { id: true, siteId: true, userId: true, role: { select: { key: true } } },
    take: BATCH,
  });
  for (const r of stale) {
    // One row at a time: a refusal (e.g. clock skew against the database) skips only that row.
    const done = await db
      .$transaction(async (tx) => {
        const updated = await tx.customerDataAccessRequest.updateMany({
          where: { id: r.id, status: "PENDING", decideBy: { lte: now } },
          data: { status: "EXPIRED", decidedAt: now },
        });
        if (updated.count !== 1) return false;
        await writeAudit(tx, {
          actorType: "SYSTEM",
          action: "iam.customer_data_access_request_expired",
          resourceType: "customer_data_access_request",
          resourceId: r.id,
          scopeType: r.siteId ? "SITE" : "PLATFORM",
          siteId: r.siteId,
          outcome: "SUCCESS",
          metadata: { roleKey: r.role.key, assigneeUserId: r.userId },
        });
        return true;
      })
      .catch(() => false);
    if (done) result.requestsExpired++;
  }

  const ended = await db.customerDataAccessRequest.findMany({
    where: { status: "APPROVED", expiryRecordedAt: null, accessExpiresAt: { lte: now } },
    select: {
      id: true,
      siteId: true,
      userId: true,
      assignmentId: true,
      accessExpiresAt: true,
      role: { select: { key: true } },
    },
    take: BATCH,
  });
  for (const r of ended) {
    const assignment = r.assignmentId
      ? await db.roleAssignment.findUnique({
          where: { id: r.assignmentId },
          select: { revokedAt: true },
        })
      : null;
    const revokedBefore =
      assignment?.revokedAt != null &&
      r.accessExpiresAt != null &&
      assignment.revokedAt < r.accessExpiresAt;
    const recorded = await db
      .$transaction(async (tx) => {
        const updated = await tx.customerDataAccessRequest.updateMany({
          where: { id: r.id, expiryRecordedAt: null },
          data: { expiryRecordedAt: now },
        });
        if (updated.count !== 1 || revokedBefore) return false;
        await writeAudit(tx, {
          actorType: "SYSTEM",
          action: "iam.customer_data_access_expired",
          resourceType: "role_assignment",
          resourceId: r.assignmentId,
          scopeType: r.siteId ? "SITE" : "PLATFORM",
          siteId: r.siteId,
          outcome: "SUCCESS",
          metadata: {
            roleKey: r.role.key,
            assigneeUserId: r.userId,
            requestId: r.id,
            expiredAt: r.accessExpiresAt?.toISOString() ?? null,
          },
        });
        return true;
      })
      .catch(() => false);
    if (recorded) result.accessExpired++;
  }
  return result;
}
