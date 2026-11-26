/**
 * DP-298 (ADR-031): the processing purposes of personal data and their legal bases, the consent
 * purposes and the rules that let a future authorised CRM workflow use AI.
 *
 * - A PURPOSE says why personal data is processed. Its legal basis is stated SEPARATELY for the
 *   GDPR (the controller is a Dutch B.V.) and for KVKK (Turkish Law No. 6698); the two regimes are
 *   never mixed in one basis. Whether KVKK applies at all (Turkish data subjects, group companies)
 *   is a legal review point (`kvkk.applicability`).
 * - INFORMATION (a notice: GDPR Art. 13 / KVKK Art. 10) and CONSENT are different things. A notice
 *   is acknowledged with the form (version + SHA-256 on the request row); a consent is an
 *   optional, separate, withdrawable record (`ConsentRecord`, one row per grant or withdrawal).
 *   A purpose whose basis is not consent never asks for one, and no consent is ever required to
 *   use a form.
 * - `status` is the legal review state of the purpose as it is written here. A purpose that is
 *   `legal_review_required` may already describe what the system does today (the review checks
 *   the wording), except where `active: false`: that processing does not happen yet and must not
 *   be described as happening.
 * - AI: no purpose forbids AI categorically (owner decision 2026-11-27). An AI task that handles
 *   personal data names the purposes it serves (`aiAllowed`) and the exact fields it may send
 *   (data minimisation, `dataCategories`); it runs only when the purpose is `approved`, the
 *   provider's data-processing terms are recorded and the transport is not live without them
 *   (apps/api/src/ai/engine/personal-data-gate.ts). The regex filter of DP-291 stays a safety
 *   net for tasks without personal data; it is never evidence of compliance.
 */
import { z } from "zod";

export type LegalReviewStatus = "approved" | "legal_review_required";

/** GDPR Art. 6(1) bases used here. */
export type GdprBasis =
  | "art_6_1_a_consent"
  | "art_6_1_b_pre_contract"
  | "art_6_1_c_legal_obligation"
  | "art_6_1_f_legitimate_interest";

/** KVKK Art. 5 bases used here (Art. 5(1) = explicit consent, açık rıza). */
export type KvkkBasis =
  | "art_5_1_explicit_consent"
  | "art_5_2_c_contract"
  | "art_5_2_c_legal_obligation"
  | "art_5_2_f_legitimate_interest";

/** Data categories a purpose may use; an AI task may send only fields of these categories. */
export const DATA_CATEGORIES = [
  "identity", // name
  "contact", // e-mail, phone
  "company", // company, country
  "enquiry", // subject, message text
  "document_interest", // which documents were requested
  "sales_pipeline", // status, assignment, staff notes
  "consent_state", // current consent per purpose (never the evidence hashes)
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export const PROCESSING_PURPOSE_IDS = [
  "customer_communication",
  "quotation",
  "crm_record",
  "sales_management",
  "analytics",
  "ai_assisted_processing",
  "marketing_email",
  "international_transfer",
] as const;
export const ProcessingPurposeIdSchema = z.enum(PROCESSING_PURPOSE_IDS);
export type ProcessingPurposeId = (typeof PROCESSING_PURPOSE_IDS)[number];

/** Consent purposes: the ones a `ConsentRecord` can grant or withdraw. */
export const CONSENT_PURPOSES = [
  "MARKETING_EMAIL",
  "AI_PERSONAL_DATA",
  "INTERNATIONAL_TRANSFER",
] as const;
export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ProcessingPurpose {
  id: ProcessingPurposeId;
  label: string;
  /** False: described for the future; the system does not do this today. */
  active: boolean;
  gdpr: { basis: GdprBasis; note: string };
  kvkk: {
    basis: KvkkBasis;
    /** Always a review point until a lawyer confirms KVKK applies to the data subjects. */
    applicability: LegalReviewStatus;
    note: string;
  };
  /** Set when the purpose's basis is consent (optional, separate, withdrawable). */
  consent: ConsentPurpose | null;
  dataCategories: readonly DataCategory[];
  /** An AI task with personal data may serve this purpose (under the gate's conditions). */
  aiAllowed: boolean;
  status: LegalReviewStatus;
  /** What the legal review has to confirm. */
  reviewPoints: readonly string[];
}

/** The processing purposes (ADR-031 D2). A change is a code change reviewed with the texts. */
export const PROCESSING_PURPOSES: Readonly<Record<ProcessingPurposeId, ProcessingPurpose>> = {
  customer_communication: {
    id: "customer_communication",
    label: "Answering enquiries and sending requested documents",
    active: true,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "Legitimate interest in answering business enquiries (LIA: docs/security/lead-legitimate-interest-assessment.md); Art. 6(1)(b) where the enquiry is a step before a contract.",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Art. 5(2)(f) legitimate interest; Art. 5(2)(c) where directly related to a contract.",
    },
    consent: null,
    dataCategories: ["identity", "contact", "company", "enquiry", "document_interest"],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: ["Confirm the LIA covers follow-up of document requests."],
  },
  quotation: {
    id: "quotation",
    label: "Preparing quotations at the customer's request",
    active: true,
    gdpr: {
      basis: "art_6_1_b_pre_contract",
      note: "Steps taken at the data subject's request before entering into a contract.",
    },
    kvkk: {
      basis: "art_5_2_c_contract",
      applicability: "legal_review_required",
      note: "Processing directly related to the establishment of a contract.",
    },
    consent: null,
    dataCategories: ["identity", "contact", "company", "enquiry", "document_interest"],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: [
      "B2B: the data subject is a contact person of a company; confirm 6(1)(b) vs 6(1)(f).",
    ],
  },
  crm_record: {
    id: "crm_record",
    label: "Keeping a customer and lead record (CRM)",
    active: true,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "Legitimate interest in a record of business contacts and what was provided to them; 24-month retention (DP-096).",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Art. 5(2)(f).",
    },
    consent: null,
    dataCategories: [
      "identity",
      "contact",
      "company",
      "enquiry",
      "document_interest",
      "sales_pipeline",
      "consent_state",
    ],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: ["Retention of customers and open opportunities is still open (DP-122)."],
  },
  sales_management: {
    id: "sales_management",
    label: "Managing sales follow-up and forecasting",
    active: true,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "Legitimate interest in organising sales follow-up; forecasting on aggregated pipeline data.",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Art. 5(2)(f).",
    },
    consent: null,
    dataCategories: ["company", "document_interest", "sales_pipeline"],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: [
      "Forecasting must not become automated decision-making with legal or similar effect (GDPR Art. 22).",
    ],
  },
  analytics: {
    id: "analytics",
    label: "Aggregate statistics about enquiries and downloads",
    active: true,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "Counts and trends only; no individual profiling and no tracking cookies.",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Art. 5(2)(f).",
    },
    consent: null,
    dataCategories: ["company", "document_interest"],
    aiAllowed: false,
    status: "legal_review_required",
    reviewPoints: ["Cookie list at launch is still open (DP-095)."],
  },
  ai_assisted_processing: {
    id: "ai_assisted_processing",
    label: "AI-assisted CRM work (summaries, e-mail and quotation drafts, forecasts)",
    active: false,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "Proposed: the AI drafts for a member of staff who decides; consent (AI_PERSONAL_DATA) only where the review requires it.",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Proposed; explicit consent if the review finds Art. 5(2)(f) does not cover it.",
    },
    consent: "AI_PERSONAL_DATA",
    dataCategories: ["identity", "company", "enquiry", "document_interest", "sales_pipeline"],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: [
      "Basis (legitimate interest + LIA, or consent) for sending CRM data to an AI provider.",
      "Provider DPA (GDPR Art. 28), no training on the data, retention at the provider.",
      "Notice wording (docs/legal/ai-assisted-processing.draft.md) before activation.",
    ],
  },
  marketing_email: {
    id: "marketing_email",
    label: "Occasional product news by e-mail",
    active: true,
    gdpr: {
      basis: "art_6_1_a_consent",
      note: "Optional, unticked, separate box; Dutch Telecommunicatiewet Art. 11.7 for e-mail. No marketing e-mail is sent before DP-097.",
    },
    kvkk: {
      basis: "art_5_1_explicit_consent",
      applicability: "legal_review_required",
      note: "Explicit consent; commercial electronic messages also fall under Turkish Law No. 6563 (İYS) if Turkish recipients are addressed.",
    },
    consent: "MARKETING_EMAIL",
    dataCategories: ["identity", "contact", "company"],
    aiAllowed: false,
    status: "approved",
    reviewPoints: [],
  },
  international_transfer: {
    id: "international_transfer",
    label: "Transfer to a service provider outside the EEA / Türkiye",
    active: false,
    gdpr: {
      basis: "art_6_1_f_legitimate_interest",
      note: "The transfer itself needs a Chapter V mechanism (adequacy, EU-US DPF, SCCs); consent (Art. 49(1)(a)) only as an exception.",
    },
    kvkk: {
      basis: "art_5_2_f_legitimate_interest",
      applicability: "legal_review_required",
      note: "Art. 9 as amended by Law No. 7499 (in force 1 June 2024): adequacy, appropriate safeguards (standard contract notified to the Authority) or an occasional exception such as explicit consent.",
    },
    consent: "INTERNATIONAL_TRANSFER",
    dataCategories: ["identity", "contact", "company", "enquiry"],
    aiAllowed: true,
    status: "legal_review_required",
    reviewPoints: [
      "No transfer outside the EEA is made today; the processor list is still open (DP-095).",
    ],
  },
};

/** The purposes an AI task with personal data may serve today (approved and AI-allowed). */
export function aiPurposeReady(id: ProcessingPurposeId): boolean {
  const p = PROCESSING_PURPOSES[id];
  return p.aiAllowed && p.active && p.status === "approved";
}

// --- consent records (ADR-031 D4) ---------------------------------------------------------------

export const CONSENT_ACTIONS = ["GRANTED", "WITHDRAWN"] as const;
export const CONSENT_SOURCES = [
  "DOCUMENT_REQUEST",
  "CONTACT_FORM",
  "STAFF",
  "PUBLIC_LINK",
  "MIGRATION",
] as const;
/** How a withdrawal reached the company (a code: no free text, so no personal data). */
export const CONSENT_WITHDRAWAL_CHANNELS = [
  "EMAIL",
  "PHONE",
  "WRITTEN",
  "IN_PERSON",
  "OTHER",
] as const;

const IsoDate = z.iso.datetime({ offset: true });

export const ConsentRecordSchema = z.strictObject({
  id: z.uuid(),
  purpose: ConsentPurposeSchema,
  action: z.enum(CONSENT_ACTIONS),
  source: z.enum(CONSENT_SOURCES),
  /** The consent text shown (a grant); null for a withdrawal. */
  textVersion: z.string().nullable(),
  textSha256: z.string().nullable(),
  /** The request or message that carried the grant. */
  sourceRecordId: z.uuid().nullable(),
  channel: z.enum(CONSENT_WITHDRAWAL_CHANNELS).nullable(),
  actor: z.strictObject({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: IsoDate,
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const ConsentStateSchema = z.strictObject({
  purpose: ConsentPurposeSchema,
  /** The latest record decides: GRANTED, WITHDRAWN, or null (never asked / never given). */
  state: z.enum(CONSENT_ACTIONS).nullable(),
  since: IsoDate.nullable(),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const LeadConsentsResponseSchema = z.strictObject({
  states: z.array(ConsentStateSchema),
  /** Newest first. */
  history: z.array(ConsentRecordSchema).max(500),
  canWithdraw: z.boolean(),
});
export type LeadConsentsResponse = z.infer<typeof LeadConsentsResponseSchema>;

export const ConsentWithdrawRequestSchema = z.strictObject({
  channel: z.enum(CONSENT_WITHDRAWAL_CHANNELS),
});
export type ConsentWithdrawRequest = z.infer<typeof ConsentWithdrawRequestSchema>;

/** The current state per purpose from a history (newest first or not; the latest wins). */
export function consentStates(
  history: readonly Pick<ConsentRecord, "purpose" | "action" | "createdAt">[],
): ConsentState[] {
  return CONSENT_PURPOSES.map((purpose) => {
    let latest: Pick<ConsentRecord, "action" | "createdAt"> | null = null;
    for (const r of history) {
      if (r.purpose !== purpose) continue;
      if (!latest || r.createdAt > latest.createdAt) latest = r;
    }
    return { purpose, state: latest?.action ?? null, since: latest?.createdAt ?? null };
  });
}
