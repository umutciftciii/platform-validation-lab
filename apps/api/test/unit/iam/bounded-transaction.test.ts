/**
 * DP-285: the transient database refusals and their API errors (bounded-transaction.ts). The
 * shapes follow Prisma 7 with @prisma/adapter-pg: a PostgreSQL error the adapter does not name is
 * `{ kind: "postgres", code, originalCode, message }` under the client error's `cause`; named
 * ones carry a kind (TransactionWriteConflict, ConnectionClosed, ...) and a Prisma code. The
 * integration tests (cms.int section 23) check the real errors.
 */
import { describe, expect, it } from "vitest";
import {
  transientDbError,
  transientDbRule,
  worstCaseMs,
} from "../../../src/iam/bounded-transaction.js";
import { ApiError } from "../../../src/iam/http/api-error.js";
import { DRY_RUN_LIMITS, IMPORT_LIMITS } from "../../../src/translation-packages/limits.js";

const prismaError = (code: string | undefined, message: string, cause?: unknown) =>
  Object.assign(new Error(message), { code, clientVersion: "7.10.1", meta: {}, cause });
const pg = (code: string, message: string) => ({
  kind: "postgres",
  code,
  originalCode: code,
  originalMessage: message,
  message,
  severity: "ERROR",
});

describe("transientDbRule", () => {
  it("a lock wait over lock_timeout, a deadlock or a write conflict is 'locked'", () => {
    const lock = pg("55P03", "canceling statement due to lock timeout");
    expect(transientDbRule(prismaError(undefined, "x", lock))).toBe("locked");
    expect(transientDbRule(lock)).toBe("locked");
    expect(transientDbRule(prismaError("P2034", "write conflict or a deadlock"))).toBe("locked");
    expect(transientDbRule(prismaError(undefined, "x", { kind: "TransactionWriteConflict" }))).toBe(
      "locked",
    );
    expect(transientDbRule(pg("40P01", "deadlock detected"))).toBe("locked");
  });

  it("statement_timeout and an expired interactive transaction are 'timeout'", () => {
    expect(
      transientDbRule(
        prismaError(undefined, "x", pg("57014", "canceling statement due to statement timeout")),
      ),
    ).toBe("timeout");
    expect(
      transientDbRule(
        prismaError(
          "P2028",
          "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 40000 ms.",
        ),
      ),
    ).toBe("timeout");
  });

  it("no pooled connection in time or too many connections is 'busy'", () => {
    expect(
      transientDbRule(
        prismaError(
          "P2028",
          "Transaction API error: Unable to start a transaction in the given time.",
        ),
      ),
    ).toBe("busy");
    expect(transientDbRule(prismaError("P2024", "Timed out fetching a new connection"))).toBe(
      "busy",
    );
    expect(transientDbRule(prismaError("P2037", "Too many database connections opened"))).toBe(
      "busy",
    );
  });

  it("a lost or refused connection is 'connection' (the outcome of a COMMIT is unknown)", () => {
    expect(transientDbRule(prismaError("P1017", "Server has closed the connection."))).toBe(
      "connection",
    );
    expect(transientDbRule(prismaError("P1001", "Can't reach database server"))).toBe("connection");
    expect(transientDbRule(prismaError(undefined, "x", { kind: "ConnectionClosed" }))).toBe(
      "connection",
    );
    expect(
      transientDbRule(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })),
    ).toBe("connection");
    expect(
      transientDbRule(pg("57P01", "terminating connection due to administrator command")),
    ).toBe("connection");
  });

  it("everything else stays unexpected: no guess from text, no other SQLSTATE, no ApiError", () => {
    expect(transientDbRule(new Error("canceling statement due to lock timeout"))).toBeNull();
    expect(transientDbRule(pg("57014", "canceling statement due to user request"))).toBeNull();
    expect(transientDbRule(prismaError("P2002", "Unique constraint failed"))).toBeNull();
    expect(
      transientDbRule(pg("25006", "cannot execute UPDATE in a read-only transaction")),
    ).toBeNull();
    expect(transientDbRule(pg("23505", "duplicate key value"))).toBeNull();
    expect(transientDbRule(prismaError("P2028", "Transaction not found."))).toBeNull();
    expect(transientDbRule(new ApiError("CONFLICT_STATE"))).toBeNull();
    expect(transientDbRule(new TypeError("x is undefined"))).toBeNull();
    expect(transientDbRule(null)).toBeNull();
    expect(transientDbRule("55P03")).toBeNull();
    const loop: Record<string, unknown> = { message: "loop" };
    loop["cause"] = loop;
    expect(transientDbRule(loop)).toBeNull();
  });
});

describe("transientDbError", () => {
  it("409 CONFLICT_STATE for a lock, 503 DATABASE_UNAVAILABLE otherwise; the rule names the cause", () => {
    const locked = transientDbError(pg("55P03", "canceling statement due to lock timeout"));
    expect(locked).toBeInstanceOf(ApiError);
    expect(locked).toMatchObject({
      code: "CONFLICT_STATE",
      status: 409,
      details: [{ path: "transaction", rule: "locked" }],
    });
    expect(transientDbError(prismaError("P1017", "closed"))).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      status: 503,
      details: [{ path: "transaction", rule: "connection" }],
    });
    expect(transientDbError(prismaError("P2002", "Unique constraint failed"))).toBeNull();
  });
});

describe("limits of the translation package routes", () => {
  it("the API answers before the admin proxy gives up (import 90 s, dry run 60 s)", () => {
    expect(worstCaseMs(IMPORT_LIMITS)).toBeLessThanOrEqual(60_000);
    expect(worstCaseMs(DRY_RUN_LIMITS)).toBeLessThanOrEqual(50_000);
    expect(DRY_RUN_LIMITS.readOnly).toBe(true);
    expect(IMPORT_LIMITS.readOnly).toBeFalsy();
    for (const l of [IMPORT_LIMITS, DRY_RUN_LIMITS]) {
      expect(l.lockTimeoutMs).toBeLessThan(l.statementTimeoutMs);
      expect(l.statementTimeoutMs).toBeLessThan(l.timeoutMs);
    }
  });
});
