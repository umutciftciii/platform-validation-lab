/**
 * Application audit events of staff authentication (`iam.*`, design 8.7). Metadata is masked by
 * `buildAuditEvent` (secrets redacted, e-mail addresses reduced); callers never pass passwords,
 * tokens, codes or proxy keys (AC-SEC-2, NT-L2). Written with a plain INSERT.
 */
import type { Prisma } from "../../generated/prisma/client.js";
import { buildAuditEvent, type AuditEventInput } from "../audit.js";
import type { Db } from "../db.js";

export async function writeAudit(db: Db, input: AuditEventInput): Promise<void> {
  const event = buildAuditEvent(input);
  await db.auditEvent.createMany({
    data: [{ ...event, metadata: event.metadata as Prisma.InputJsonObject }],
  });
}
