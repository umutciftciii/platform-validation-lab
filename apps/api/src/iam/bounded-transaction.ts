/**
 * DP-285: interactive transactions with a bounded wait, and the transient database refusals
 * mapped to the API error model.
 *
 * Prisma's interactive transaction `timeout` does not stop a statement that PostgreSQL is still
 * running or that waits for a lock: the transaction is only marked expired, and the request waits
 * until the statement returns (ML-13b E2E: 85 s behind a table lock, then a generic 500; with a
 * longer lock the admin proxy answered 502 after 90 s). `boundedTransaction` therefore sets three
 * limits, all transaction-local (`set_config(..., true)`: they end with the transaction, so the
 * pooled connection is unchanged for its next user):
 *
 *  - `lock_timeout`: one lock wait is cancelled by the database (SQLSTATE 55P03);
 *  - `statement_timeout`: one statement is cancelled by the database (SQLSTATE 57014);
 *  - Prisma `timeout` / `maxWait`: the whole transaction, and the wait for a pooled connection.
 *
 * Worst case of the call: maxWait + timeout + statementTimeout (the statement running when the
 * transaction expires still ends at its own limit). Callers keep that below the proxy's limit.
 *
 * Every refusal `boundedTransaction` causes happens before COMMIT, so PostgreSQL rolls the whole
 * transaction back: nothing is written. Only a lost connection leaves the outcome unknown (the
 * COMMIT may have reached the database). `transientDbError` keeps these apart:
 *
 *  | cause                                            | answer                                   |
 *  | ------------------------------------------------ | ---------------------------------------- |
 *  | lock wait over the limit, deadlock, write conflict | 409 CONFLICT_STATE `{transaction, locked}`  |
 *  | statement or transaction over its limit          | 503 DATABASE_UNAVAILABLE `{transaction, timeout}` |
 *  | no pooled connection in time, too many connections | 503 DATABASE_UNAVAILABLE `{transaction, busy}` |
 *  | connection lost or database not reachable        | 503 DATABASE_UNAVAILABLE `{transaction, connection}` (outcome unknown) |
 *  | anything else                                    | `null` (the caller's normal handling: 500) |
 *
 * Only these exact causes are mapped (SQLSTATE, Prisma code or driver adapter kind, never a guess
 * from free text alone); a cancelled statement that was not a timeout (e.g. an operator's
 * pg_cancel_backend) stays unexpected.
 */
import { ApiError } from "./http/api-error.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  siteScopedExtension,
  withoutRaw,
  type SiteScope,
  type SiteScopedClient,
} from "./site-scope.js";

export interface TransactionLimits {
  /** Longest wait for one lock, in ms (PostgreSQL `lock_timeout`). */
  lockTimeoutMs: number;
  /** Longest run of one statement, in ms (PostgreSQL `statement_timeout`). */
  statementTimeoutMs: number;
  /** Longest run of the whole transaction, in ms (Prisma `timeout`). */
  timeoutMs: number;
  /** Longest wait for a pooled connection, in ms (Prisma `maxWait`). */
  maxWaitMs: number;
  /** The transaction may not write (`transaction_read_only`). */
  readOnly?: boolean;
}

/** Upper bound of a `boundedTransaction` call with these limits (before mapping the error). */
export function worstCaseMs(l: TransactionLimits): number {
  return l.maxWaitMs + l.timeoutMs + l.statementTimeoutMs;
}

const ms = (n: number) => {
  if (!Number.isInteger(n) || n <= 0) throw new Error("transaction limits must be positive ms");
  return `${n}ms`;
};

export async function boundedTransaction<T>(
  prisma: PrismaClient,
  scope: SiteScope,
  limits: TransactionLimits,
  fn: (db: SiteScopedClient) => Promise<T>,
): Promise<T> {
  const lock = ms(limits.lockTimeoutMs);
  const statement = ms(limits.statementTimeoutMs);
  ms(limits.timeoutMs);
  ms(limits.maxWaitMs);
  const readOnly = limits.readOnly ? "on" : "off";
  const client = siteScopedExtension(prisma, scope);
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${lock}, true),
        set_config('statement_timeout', ${statement}, true)`;
      if (readOnly === "on") {
        await tx.$executeRaw`SELECT set_config('transaction_read_only', ${readOnly}, true)`;
      }
      return fn(withoutRaw(tx) as unknown as SiteScopedClient);
    },
    { timeout: limits.timeoutMs, maxWait: limits.maxWaitMs },
  );
}

export type TransientDbRule = "locked" | "timeout" | "busy" | "connection";

interface Facts {
  sqlStates: Set<string>;
  prismaCodes: Set<string>;
  kinds: Set<string>;
  messages: string[];
}

/** Codes, driver adapter kinds and messages anywhere in the error (cause chain, meta). */
function factsOf(error: unknown): Facts {
  const f: Facts = { sqlStates: new Set(), prismaCodes: new Set(), kinds: new Set(), messages: [] };
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || seen.has(e) || depth > 8) return;
    seen.add(e);
    const o = e as Record<string, unknown>;
    for (const field of ["code", "originalCode"]) {
      const v = o[field];
      if (typeof v !== "string") continue;
      if (/^P\d{4}$/.test(v)) f.prismaCodes.add(v);
      else if (/^[0-9A-Z]{5}$/.test(v)) f.sqlStates.add(v);
      else if (/^E[A-Z]+$/.test(v)) f.kinds.add(v);
    }
    if (typeof o["kind"] === "string") f.kinds.add(o["kind"]);
    for (const field of ["message", "originalMessage", "reason"]) {
      const v = o[field];
      if (typeof v === "string") f.messages.push(v);
    }
    for (const field of ["cause", "meta", "driverAdapterError"]) visit(o[field], depth + 1);
  };
  visit(error, 0);
  return f;
}

const LOCKED_STATES = ["55P03", "40P01", "40001"];
const CONNECTION_STATES = ["57P01", "57P02", "57P03", "08000", "08003", "08006"];
const CONNECTION_KINDS = [
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
];
const CONNECTION_CODES = ["P1001", "P1002", "P1008", "P1017"];

/** The rule of a transient database refusal, or null when the error is anything else. */
export function transientDbRule(error: unknown): TransientDbRule | null {
  if (error instanceof ApiError) return null;
  const f = factsOf(error);
  const text = f.messages.join("\n");
  const has = (set: Set<string>, list: readonly string[]) => list.some((x) => set.has(x));
  if (has(f.sqlStates, LOCKED_STATES) || f.kinds.has("TransactionWriteConflict")) return "locked";
  if (f.prismaCodes.has("P2034")) return "locked";
  if (f.sqlStates.has("57014") && /statement timeout/i.test(text)) return "timeout";
  if (f.prismaCodes.has("P2028")) {
    if (/unable to start a transaction in the given time/i.test(text)) return "busy";
    if (/expired|timeout|timed out/i.test(text)) return "timeout";
    return null;
  }
  if (f.prismaCodes.has("P2024") || f.prismaCodes.has("P2037")) return "busy";
  if (f.sqlStates.has("53300") || f.kinds.has("TooManyConnections")) return "busy";
  if (has(f.sqlStates, CONNECTION_STATES) || has(f.kinds, CONNECTION_KINDS)) return "connection";
  if (has(f.prismaCodes, CONNECTION_CODES)) return "connection";
  return null;
}

/** The API error of a transient database refusal (table above), or null. */
export function transientDbError(error: unknown): ApiError | null {
  const rule = transientDbRule(error);
  if (!rule) return null;
  const details = [{ path: "transaction", rule }];
  return rule === "locked"
    ? new ApiError("CONFLICT_STATE", details)
    : new ApiError("DATABASE_UNAVAILABLE", details);
}
