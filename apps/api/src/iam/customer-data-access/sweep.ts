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
 * deletes anything. Batches of 200 rows per step and run.
 */
import { customerDataSweep } from "../iam-context.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

export interface SweepResult {
  requestsExpired: number;
  accessExpired: number;
}

/**
 * DP-125 (K3): "CustomerDataAccessRequest" and "RoleAssignment" are under row-level security and
 * the sweep runs without a session. Both steps run in the database (iam_customer_data_sweep,
 * SECURITY DEFINER), row by row with their audit events, never ahead of the database clock; the
 * result is counts only. Removing the legacy flow altogether is DP-130.
 */
export async function runCustomerDataAccessSweep(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<SweepResult> {
  return customerDataSweep(db, now);
}
