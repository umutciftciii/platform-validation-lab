/**
 * Lead retention, anonymisation and erasure on request (DP-096; ADR-003 §4-5, ADR-016 D10).
 *
 * ONE code path for everything that removes lead data: the scheduled report (dry-run), the
 * operator's retention run and an erasure request all use `planRetention` / `anonymiseLeads`.
 *
 * - Writes run inside one transaction as the least-privilege role `dp_lead_retention`
 *   (`SET LOCAL ROLE`), which only the operator credential may assume. The database enforces what
 *   that role may change (migration 20261122090000_dp_096_lead_retention): identity and link
 *   fields to their cleared values, unused expired grants, expired rate-limit buckets.
 * - A lead is due 24 months after the later of its last request and its last consent activity;
 *   a marketing consent alone never extends that (consent is only given with a request).
 * - Held leads (customer, open sales opportunity, legal hold) are never anonymised automatically
 *   and an erasure request for them is refused for manual legal review (D-R1, D-R6). Since
 *   DP-041 (ADR-019 D5) the sales pipeline counts as held too: a QUALIFIED lead is an open
 *   opportunity, a CONVERTED one a customer (`PIPELINE_HELD`; the database refuses to anonymise
 *   them, CHECK "Lead_anonymised_pipeline").
 * - The anonymisation also clears the free text of the lead's sales activity (notes, contact
 *   summaries); who did what and when stays as evidence.
 * - Nothing here logs or audits personal data: counts, ids and outcome codes only.
 * - "Anonymised" means the identity and link fields below are cleared. The rest of the row
 *   (`RETAINED_FIELDS`) is kept as evidence and is reported as retained, never as anonymous on
 *   its own (D-R1).
 */
import type { Db } from "../iam/db.js";
import { writeAudit } from "../iam/staff/audit-writer.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export const LEAD_RETENTION = {
  /** D-R1: months after the last request / consent activity. */
  leadMonths: 24,
  /** D-R2: days after the request. */
  ipHmacDays: 90,
  /** D-R3: days after expiry, unused grants only (the database checks the same rule). */
  unusedGrantDays: 30,
} as const;

/** Fields cleared by the anonymisation. */
export const CLEARED_FIELDS = [
  "Lead.email (replaced by anonymised+<id>@anonymised.invalid)",
  "Lead.fullName",
  "Lead.company",
  "Lead.marketingConsentAt",
  "LeadDocumentRequest.fullName",
  "LeadDocumentRequest.company",
  "LeadDocumentRequest.ipPrefixHmac",
  "LeadDocumentRequest.reference (printed on the PDF)",
  "LeadDocumentRequest.requestId",
  "LeadDocumentDownload.sha256 (of the stamped PDF)",
  "LeadDocumentDownload.httpRequestId",
  "LeadContactMessage.fullName, company, phone, subject, message, ipPrefixHmac, requestId (DP-151)",
  "LeadActivity.body (sales notes and contact summaries, DP-041)",
] as const;

/** Kept as evidence; not identifying on their own, but not claimed to be anonymous either. */
export const RETAINED_FIELDS = [
  "site, country, free-mail flag, request count, request times",
  "document, revision and product of each request",
  "time and country of each contact message (DP-151)",
  "notice and consent versions and SHA-256, consent flag",
  "download size and time; grant expiry and counters",
  "sales status and assignment; activity kind, time, channel and staff actor (DP-041)",
] as const;

/** DP-041 (ADR-019 D5): sales statuses that keep a lead like a hold (open opportunity, customer). */
export const PIPELINE_HELD = ["QUALIFIED", "CONVERTED"] as const;

export interface RetentionPlan {
  /** Leads past the 24 months, not held, not yet anonymised. */
  leadsDue: number;
  /**
   * Leads past the 24 months that a hold or the sales pipeline (QUALIFIED, CONVERTED) keeps
   * (reported, never anonymised automatically).
   */
  leadsHeld: number;
  /** Requests older than 90 days that still carry an IP prefix HMAC. */
  ipHmacDue: number;
  /** Grants never used that expired more than 30 days ago. */
  unusedGrantsDue: number;
  /** Rate-limit buckets whose window has ended. */
  rateLimitBucketsDue: number;
}

export interface RetentionCutoffs {
  lead: Date;
  ipHmac: Date;
  unusedGrant: Date;
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const lead = new Date(now);
  lead.setUTCMonth(lead.getUTCMonth() - LEAD_RETENTION.leadMonths);
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  return {
    lead,
    ipHmac: days(LEAD_RETENTION.ipHmacDays),
    unusedGrant: days(LEAD_RETENTION.unusedGrantDays),
  };
}

/**
 * Read-only: what a retention run would do at `now`. Counts only, through the reviewed SECURITY
 * DEFINER function `leads_retention_plan` (DP-103): the lead tables have row-level security, so
 * the scheduled report (dp_app) and the operator's run (dp_lead_retention) share this one query.
 */
export async function planRetention(db: Db, now: Date): Promise<RetentionPlan> {
  const c = retentionCutoffs(now);
  const [row] = await db.$queryRaw<
    {
      leads_due: bigint;
      leads_held: bigint;
      ip_hmac_due: bigint;
      unused_grants_due: bigint;
      buckets_due: bigint;
    }[]
  >`SELECT * FROM leads_retention_plan(${c.lead}::timestamptz, ${c.ipHmac}::timestamptz,
    ${c.unusedGrant}::timestamptz, ${now}::timestamptz)`;
  return {
    leadsDue: Number(row?.leads_due ?? 0),
    leadsHeld: Number(row?.leads_held ?? 0),
    ipHmacDue: Number(row?.ip_hmac_due ?? 0),
    unusedGrantsDue: Number(row?.unused_grants_due ?? 0),
    rateLimitBucketsDue: Number(row?.buckets_due ?? 0),
  };
}

async function asRetentionRole(tx: Db): Promise<void> {
  // A fixed identifier (SET ROLE cannot take a bind parameter); for the transaction only.
  await tx.$executeRaw`SET LOCAL ROLE dp_lead_retention`;
}

/**
 * Clears identity and link fields of the given leads (not held, not yet anonymised) and of their
 * requests and downloads. Must run as dp_lead_retention inside a transaction. Returns the ids
 * that were anonymised.
 */
export async function anonymiseLeads(tx: Db, leadIds: string[], now: Date): Promise<string[]> {
  if (leadIds.length === 0) return [];
  const eligible = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS id FROM "Lead"
    WHERE "id" = ANY(${leadIds}::uuid[]) AND "anonymisedAt" IS NULL AND "retentionHold" IS NULL
      AND "status" NOT IN ('QUALIFIED', 'CONVERTED')
    FOR UPDATE`;
  const ids = eligible.map((r) => r.id);
  if (ids.length === 0) return [];
  await tx.$executeRaw`
    UPDATE "LeadDocumentDownload" SET "sha256" = NULL, "httpRequestId" = NULL
    WHERE "requestId" IN (SELECT r."id" FROM "LeadDocumentRequest" r WHERE r."leadId" = ANY(${ids}::uuid[]))`;
  await tx.$executeRaw`
    UPDATE "LeadActivity" SET "body" = NULL, "redactedAt" = ${now}
    WHERE "leadId" = ANY(${ids}::uuid[]) AND "body" IS NOT NULL`;
  await tx.$executeRaw`
    UPDATE "LeadDocumentRequest"
    SET "fullName" = '', "company" = '', "ipPrefixHmac" = NULL, "reference" = NULL, "requestId" = NULL
    WHERE "leadId" = ANY(${ids}::uuid[])`;
  // DP-151: before the lead (an anonymised lead never changes again).
  await tx.$executeRaw`
    UPDATE "LeadContactMessage"
    SET "fullName" = '', "company" = '', "phone" = NULL, "subject" = NULL, "message" = NULL,
        "ipPrefixHmac" = NULL, "requestId" = NULL, "redactedAt" = ${now}
    WHERE "leadId" = ANY(${ids}::uuid[]) AND "redactedAt" IS NULL`;
  await tx.$executeRaw`
    UPDATE "Lead"
    SET "email" = 'anonymised+' || "id"::text || '@anonymised.invalid', "fullName" = '', "company" = '',
        "marketingConsentAt" = NULL, "anonymisedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ANY(${ids}::uuid[])`;
  return ids;
}

export interface RetentionResult {
  dryRun: boolean;
  plan: RetentionPlan;
  /** Counts actually changed (all zero in a dry run). */
  applied: {
    leadsAnonymised: number;
    ipHmacCleared: number;
    unusedGrantsDeleted: number;
    rateLimitBucketsDeleted: number;
  };
}

export interface RetentionRunOptions {
  apply: boolean;
  /** Production only: the reference of the owner's separate approval (recorded in audit). */
  productionApproval?: string | null;
}

/** pg_advisory_xact_lock key: "LEADRET" in ASCII. */
export const RETENTION_LOCK_KEY = 21479156716913236n;

/**
 * The retention run. Dry run (default): plans and changes nothing, not even the audit trail.
 * Apply: one transaction as dp_lead_retention, one audit event with counts only.
 */
export async function runRetention(
  operator: PrismaClient,
  now: Date,
  options: RetentionRunOptions,
): Promise<RetentionResult> {
  if (!options.apply) {
    const plan = await operator.$transaction(async (tx) => {
      await asRetentionRole(tx);
      return planRetention(tx, now);
    });
    return {
      dryRun: true,
      plan,
      applied: {
        leadsAnonymised: 0,
        ipHmacCleared: 0,
        unusedGrantsDeleted: 0,
        rateLimitBucketsDeleted: 0,
      },
    };
  }
  return operator.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RETENTION_LOCK_KEY})`;
    await asRetentionRole(tx);
    const plan = await planRetention(tx, now);
    const c = retentionCutoffs(now);
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT l."id"::text AS id FROM "Lead" l
      WHERE l."anonymisedAt" IS NULL AND l."retentionHold" IS NULL
        AND l."status" NOT IN ('QUALIFIED', 'CONVERTED')
        AND GREATEST(l."lastRequestAt", COALESCE(l."marketingConsentAt", l."lastRequestAt")) < ${c.lead}`;
    const anonymised = await anonymiseLeads(
      tx,
      due.map((r) => r.id),
      now,
    );
    const ipHmacCleared =
      (await tx.$executeRaw`
        UPDATE "LeadDocumentRequest" SET "ipPrefixHmac" = NULL
        WHERE "ipPrefixHmac" IS NOT NULL AND "createdAt" < ${c.ipHmac}`) +
      (await tx.$executeRaw`
        UPDATE "LeadContactMessage" SET "ipPrefixHmac" = NULL
        WHERE "ipPrefixHmac" IS NOT NULL AND "createdAt" < ${c.ipHmac}`);
    const unusedGrantsDeleted = await tx.$executeRaw`
      DELETE FROM "DocumentDownloadGrant" WHERE "downloadCount" = 0 AND "expiresAt" < ${c.unusedGrant}`;
    const rateLimitBucketsDeleted = await tx.$executeRaw`
      DELETE FROM "PublicRateLimit" WHERE "expiresAt" <= ${now}`;
    const applied = {
      leadsAnonymised: anonymised.length,
      ipHmacCleared,
      unusedGrantsDeleted,
      rateLimitBucketsDeleted,
    };
    await writeAudit(tx, {
      actorType: "BOOTSTRAP",
      action: "leads.retention_applied",
      resourceType: "lead_retention",
      scopeType: "PLATFORM",
      outcome: "SUCCESS",
      metadata: {
        ...applied,
        leadsHeld: plan.leadsHeld,
        cutoffLead: c.lead.toISOString(),
        ...(options.productionApproval ? { productionApproval: options.productionApproval } : {}),
      },
    });
    return { dryRun: false, plan, applied };
  });
}

// --- erasure on request (GDPR Art. 17) ---------------------------------------------------------

/** An identity check reference: a ticket id, never an e-mail address or a name. */
export const IDENTITY_CHECK_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

export type ErasureOutcome = "erased" | "would_erase" | "no_match" | "held";

export interface ErasureResult {
  outcome: ErasureOutcome;
  /** Leads of this e-mail on any site, not yet anonymised. */
  matched: number;
  /**
   * Matched leads that a hold or the sales pipeline protects (customer, open opportunity, legal
   * hold; QUALIFIED or CONVERTED).
   */
  held: number;
  anonymised: number;
}

export interface ErasureRequest {
  email: string;
  /** Reference of the identity check (reply to the stored address), see IDENTITY_CHECK_PATTERN. */
  identityCheck: string;
  apply: boolean;
}

/**
 * Erasure on request: every live lead with this e-mail, on every site. Refused as a whole when
 * any of them is held (legal exception check: a person decides, not the tool). Dry run unless
 * `apply`; audited per lead (id and outcome, never the e-mail).
 */
export async function eraseByEmail(
  operator: PrismaClient,
  request: ErasureRequest,
  now: Date,
): Promise<ErasureResult> {
  if (!IDENTITY_CHECK_PATTERN.test(request.identityCheck) || request.identityCheck.includes("@")) {
    throw new Error(
      "identity check reference: 3-64 letters, digits or . _ : - (a ticket id, no e-mail)",
    );
  }
  const email = request.email.trim().toLowerCase();
  return operator.$transaction(async (tx) => {
    await asRetentionRole(tx);
    const leads = await tx.$queryRaw<{ id: string; siteId: string; held: boolean }[]>`
      SELECT "id"::text AS id, "siteId"::text AS "siteId",
        ("retentionHold" IS NOT NULL OR "status" IN ('QUALIFIED', 'CONVERTED')) AS held
      FROM "Lead" WHERE "email" = ${email} AND "anonymisedAt" IS NULL
      ORDER BY "id" FOR UPDATE`;
    const held = leads.filter((l) => l.held).length;
    const base = { matched: leads.length, held, anonymised: 0 };
    if (leads.length === 0) {
      if (request.apply) {
        await writeAudit(tx, {
          actorType: "BOOTSTRAP",
          action: "leads.erasure_requested",
          resourceType: "lead",
          scopeType: "PLATFORM",
          outcome: "DENIED",
          reason: "no lead matched",
          metadata: { identityCheck: request.identityCheck },
        });
      }
      return { ...base, outcome: "no_match" };
    }
    if (held > 0) {
      if (request.apply) {
        for (const l of leads) {
          await writeAudit(tx, {
            actorType: "BOOTSTRAP",
            action: "leads.erasure_requested",
            resourceType: "lead",
            resourceId: l.id,
            scopeType: "SITE",
            siteId: l.siteId,
            outcome: "DENIED",
            reason: "retention hold: manual legal review",
            metadata: { identityCheck: request.identityCheck, held: l.held },
          });
        }
      }
      return { ...base, outcome: "held" };
    }
    if (!request.apply) return { ...base, outcome: "would_erase" };
    const ids = await anonymiseLeads(
      tx,
      leads.map((l) => l.id),
      now,
    );
    for (const l of leads) {
      await writeAudit(tx, {
        actorType: "BOOTSTRAP",
        action: "leads.erasure_applied",
        resourceType: "lead",
        resourceId: l.id,
        scopeType: "SITE",
        siteId: l.siteId,
        outcome: "SUCCESS",
        metadata: { identityCheck: request.identityCheck },
      });
    }
    return { ...base, anonymised: ids.length, outcome: "erased" };
  });
}

// --- holds (D-R1: customers and open opportunities) --------------------------------------------

export const RETENTION_HOLDS = ["CUSTOMER", "OPEN_OPPORTUNITY", "LEGAL_HOLD"] as const;
export type RetentionHold = (typeof RETENTION_HOLDS)[number];

export interface HoldResult {
  outcome: "set" | "cleared" | "unchanged" | "no_match";
}

/** Sets or clears the hold of one live lead (site key + e-mail). Audited with the lead id only. */
export async function setRetentionHold(
  operator: PrismaClient,
  input: {
    email: string;
    siteKey: "BV" | "CORPORATE";
    hold: RetentionHold | null;
    reference: string;
  },
  now: Date,
): Promise<HoldResult> {
  if (!IDENTITY_CHECK_PATTERN.test(input.reference) || input.reference.includes("@")) {
    throw new Error("reference: 3-64 letters, digits or . _ : - (a ticket id, no e-mail)");
  }
  const email = input.email.trim().toLowerCase();
  return operator.$transaction(async (tx) => {
    await asRetentionRole(tx);
    const [lead] = await tx.$queryRaw<{ id: string; siteId: string; hold: string | null }[]>`
      SELECT l."id"::text AS id, l."siteId"::text AS "siteId", l."retentionHold"::text AS hold
      FROM "Lead" l JOIN "Site" s ON s."id" = l."siteId"
      WHERE l."email" = ${email} AND s."key"::text = ${input.siteKey} AND l."anonymisedAt" IS NULL
      FOR UPDATE OF l`;
    if (!lead) return { outcome: "no_match" };
    if (lead.hold === input.hold) return { outcome: "unchanged" };
    if (input.hold) {
      await tx.$executeRaw`
        UPDATE "Lead" SET "retentionHold" = ${input.hold}::"LeadRetentionHold", "retentionHoldAt" = ${now},
          "updatedAt" = ${now}
        WHERE "id" = ${lead.id}::uuid`;
    } else {
      await tx.$executeRaw`
        UPDATE "Lead" SET "retentionHold" = NULL, "retentionHoldAt" = NULL, "updatedAt" = ${now}
        WHERE "id" = ${lead.id}::uuid`;
    }
    await writeAudit(tx, {
      actorType: "BOOTSTRAP",
      action: input.hold ? "leads.retention_hold_set" : "leads.retention_hold_cleared",
      resourceType: "lead",
      resourceId: lead.id,
      scopeType: "SITE",
      siteId: lead.siteId,
      outcome: "SUCCESS",
      metadata: { hold: input.hold, previous: lead.hold, reference: input.reference },
    });
    return { outcome: input.hold ? "set" : "cleared" };
  });
}
