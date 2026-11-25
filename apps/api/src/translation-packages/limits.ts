import type { TransactionLimits } from "../iam/bounded-transaction.js";

/**
 * DP-285: limits of the dry run's and the import's transaction (bounded-transaction.ts). Worst
 * case maxWait + timeout + statement: import 60 s (admin proxy 90 s), dry run 50 s (proxy 60 s),
 * so the API always answers before the proxy gives up. A lock held by another session for longer
 * than 5 s ends the request with 409 `{transaction, locked}`; nothing is written.
 */
export const IMPORT_LIMITS: TransactionLimits = {
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  timeoutMs: 40_000,
  maxWaitMs: 5_000,
};
export const DRY_RUN_LIMITS: TransactionLimits = {
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  timeoutMs: 30_000,
  maxWaitMs: 5_000,
  readOnly: true,
};
