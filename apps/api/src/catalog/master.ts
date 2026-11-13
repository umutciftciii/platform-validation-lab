/**
 * Content changes of a product master (PM-3). Every write that changes what a reviewer approves
 * (master fields, specification values, images) goes through `changeMaster`, inside its own
 * transaction and before any other write of that transaction:
 *
 *  1. the product row is locked (a no-op UPDATE), so a concurrent review decision, publication
 *     or other change waits for this transaction and then sees its result;
 *  2. archived masters and stale versions are refused;
 *  3. the version is bumped and the caller is recorded as an editor of the current revision
 *     (separation of duties: an editor cannot approve the revision);
 *  4. a master that was IN_REVIEW or APPROVED returns to DRAFT (the database trigger does the
 *     reset; this records it in the review history and the audit trail), so an approval never
 *     silently covers later edits. Live publications keep their approved snapshot.
 */
import { ApiError } from "../iam/http/api-error.js";
import type { StaffAccess } from "../iam/staff/access.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { staleVersion } from "./errors.js";

type TxCallback = Extract<Parameters<SiteScopedClient["$transaction"]>[0], (tx: never) => unknown>;
/** The client of a running transaction on the site-scoped client. */
export type ScopedTx = Parameters<TxCallback>[0];

export const MASTER = "product_master:edit";

export interface MasterRow {
  id: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";
  version: number;
  revisionEditorIds: string[];
  submittedById: string | null;
}

const MASTER_SELECT = {
  id: true,
  status: true,
  version: true,
  revisionEditorIds: true,
  submittedById: true,
} as const;

/** Locks the product row for the rest of the transaction and reads it; null when unknown. */
export async function lockMaster(tx: ScopedTx, id: string): Promise<MasterRow | null> {
  const locked = await tx.product.updateMany({
    where: { id },
    data: { version: { increment: 0 } },
  });
  if (locked.count !== 1) return null;
  return tx.product.findUniqueOrThrow({ where: { id }, select: MASTER_SELECT });
}

export interface MasterChange {
  before: MasterRow;
  after: MasterRow;
  /** The review state the change ended ("IN_REVIEW" or "APPROVED"), or null. */
  reset: "IN_REVIEW" | "APPROVED" | null;
}

export async function changeMaster(
  tx: ScopedTx,
  a: StaffAccess,
  productId: string,
  opts: {
    /** The master version the change was based on; omitted for image changes (own versions). */
    expectedVersion?: number;
    /** Master fields to write together with the version bump. */
    data?: Record<string, unknown>;
    /** Sent with the reset audit event (what kind of change caused it). */
    cause: string;
  },
): Promise<MasterChange> {
  const before = await lockMaster(tx, productId);
  if (!before) throw new ApiError("NOT_FOUND");
  if (before.status === "ARCHIVED") {
    throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
  }
  if (opts.expectedVersion !== undefined && before.version !== opts.expectedVersion) {
    throw staleVersion();
  }
  const editors = before.revisionEditorIds.includes(a.userId)
    ? before.revisionEditorIds
    : [...before.revisionEditorIds, a.userId];
  const after = await tx.product.update({
    where: { id: productId },
    data: { ...(opts.data ?? {}), version: { increment: 1 }, revisionEditorIds: editors },
    select: MASTER_SELECT,
  });
  const reset =
    before.status !== after.status &&
    (before.status === "IN_REVIEW" || before.status === "APPROVED")
      ? before.status
      : null;
  if (reset) {
    await tx.productReviewEvent.create({
      data: {
        productId,
        siteId: null,
        action: "REVIEW_RESET",
        productVersion: after.version,
        actorUserId: a.userId,
      },
    });
    await a.audit(tx, {
      action: "catalog.product_review_reset",
      resourceType: "product",
      resourceId: productId,
      siteId: null,
      permission: MASTER,
      metadata: { previousStatus: reset, cause: opts.cause, version: after.version },
    });
  }
  return { before, after, reset };
}
