/**
 * Public delivery of technical documents (PM-5, DP-035; ADR-014).
 *
 * 1. Access decision (`decideDocumentAccess`): fail-closed. A policy is downloadable only when
 *    the infrastructure it depends on exists. PUBLIC needs nothing; LEAD_REQUIRED needs a
 *    download grant of a lead request (DP-042, DP-043; ADR-016); MEMBERS_ONLY waits for the
 *    member accounts (DP-039). INTERNAL never leaves the admin. The switches are code constants
 *    on purpose: turning one on is a reviewed change together with the feature it depends on,
 *    never configuration.
 *
 * 2. Stamping (`DocumentStamper`): every public download goes through the stamper chosen for its
 *    policy. PUBLIC uses the identity stamper (the published file as uploaded). LEAD_REQUIRED uses
 *    the watermark stamper (watermark.ts, DP-043). A policy without a registered stamper refuses
 *    to deliver, so a gated document can never leave unstamped by mistake.
 */
import type { DocumentAccessPolicy } from "@dream/contracts";

/** Infrastructure a gated policy depends on. Flip only with the feature (see the header). */
export const DOCUMENT_ACCESS_CAPABILITIES = {
  /** DP-039: member registration, verification and member sessions on the public sites. */
  memberAccounts: false,
  /** DP-042 + DP-043: lead form, consent evidence and short-lived download grants (ADR-016). */
  leadGrants: true,
} as const;

export type DocumentAccessCapabilities = {
  readonly [K in keyof typeof DOCUMENT_ACCESS_CAPABILITIES]: boolean;
};

export type DocumentAccess =
  | { downloadable: true; requires: "nothing" | "member_session" | "lead_grant" }
  | { downloadable: false; reason: "internal" | "awaiting_membership" | "awaiting_lead_capture" };

/**
 * Whether a site may hand out a document of this policy at all. A `requires` other than
 * "nothing" must still be proven per request: `lead_grant` by a valid download grant of a lead
 * request (ADR-016 D4); `member_session` cannot be proven yet (DP-039) and is refused.
 */
export function decideDocumentAccess(
  policy: DocumentAccessPolicy,
  capabilities: DocumentAccessCapabilities = DOCUMENT_ACCESS_CAPABILITIES,
): DocumentAccess {
  switch (policy) {
    case "PUBLIC":
      return { downloadable: true, requires: "nothing" };
    case "MEMBERS_ONLY":
      return capabilities.memberAccounts
        ? { downloadable: true, requires: "member_session" }
        : { downloadable: false, reason: "awaiting_membership" };
    case "LEAD_REQUIRED":
      return capabilities.leadGrants
        ? { downloadable: true, requires: "lead_grant" }
        : { downloadable: false, reason: "awaiting_lead_capture" };
    default:
      return { downloadable: false, reason: "internal" };
  }
}

/** What a stamper knows about one delivery. Personal data only in `grant` (lead downloads). */
export interface DeliveryContext {
  documentId: string;
  revisionId: string;
  revisionNumber: number;
  siteId: string;
  policy: DocumentAccessPolicy;
  /** DP-043: the download grant, its request reference and recipient. Absent for PUBLIC. */
  grant?: { id: string; reference: string; recipientLabel: string; issuedAt: Date };
  requestId: string;
  deliveredAt: Date;
}

export interface DocumentStamper {
  readonly name: string;
  /** Returns the bytes to send. Must not change a PUBLIC file's content. */
  stamp(pdf: Buffer, ctx: DeliveryContext): Promise<Buffer>;
}

/** PUBLIC documents: the published file exactly as uploaded (its sha256 stays valid). */
export const IDENTITY_STAMPER: DocumentStamper = {
  name: "identity",
  stamp: (pdf) => Promise.resolve(pdf),
};

export class StamperMissing extends Error {
  override name = "StamperMissing";
}

/**
 * The stamper of each policy. The catalogue module registers the watermark stamper for
 * LEAD_REQUIRED (DP-043); MEMBERS_ONLY has none until DP-039, so asking for it fails (and the
 * access decision above already refuses it, so this is the second line).
 */
export class DocumentStampers {
  private readonly byPolicy = new Map<DocumentAccessPolicy, DocumentStamper>([
    ["PUBLIC", IDENTITY_STAMPER],
  ]);

  register(policy: Exclude<DocumentAccessPolicy, "INTERNAL">, stamper: DocumentStamper): void {
    if (policy === "PUBLIC" && stamper !== IDENTITY_STAMPER) {
      throw new Error("PUBLIC documents are delivered unchanged");
    }
    this.byPolicy.set(policy, stamper);
  }

  for(policy: DocumentAccessPolicy): DocumentStamper {
    const stamper = policy === "INTERNAL" ? undefined : this.byPolicy.get(policy);
    if (!stamper) throw new StamperMissing(`no stamper for ${policy}`);
    return stamper;
  }
}
