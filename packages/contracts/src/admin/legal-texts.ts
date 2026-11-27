/**
 * DP-298 (ADR-031 D1): legal and consent texts are managed in the admin ("Legal texts", under
 * Content) as VERSIONS stored in the database (`LegalTextVersion`). The API is the only runtime
 * source: the forms, the privacy pages and the evidence check read the published versions from it.
 *
 * - A version is a DRAFT until it is published. A draft can be edited and deleted; one draft per
 *   document and language at a time.
 * - Publishing gives the version its name (`<date>.<locale>`, `<date>.<n>.<locale>` for a second
 *   one on the same day) and freezes it: a published text never changes (database trigger), so a
 *   version and SHA-256 stored with a form always name the exact words the visitor saw. The newest
 *   published version of a document and language is the current one; earlier ones stay as
 *   evidence. A form that still shows an older version is answered LEAD_TEXT_OUTDATED (D-T7).
 * - `legalReview` is the lawyer's check of the wording, separate from publication. A version may
 *   be published for local and staging review while its legal review is pending; production
 *   publication of the privacy page and the forms stays blocked until every current version they
 *   use is `APPROVED` (`privacyBlockers`, replaces the `final` flags of DP-095 D-T3).
 * - Permissions: `legal_text:edit` (drafts) and `legal_text:publish` (publish, record the legal
 *   review). Both are platform-wide; publishing is not a super admin default (like every
 *   publication, F1-001B), so only the system owner publishes unless the owner grants it.
 * - The English texts that were constants (leads.ts, privacy.ts) are the seed of migration
 *   20261222090000_dp_298_legal_texts_consents with the same words, versions and SHA-256: the
 *   evidence stored before DP-298 still matches.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import type { ProcessingPurposeIdSchema } from "../data-processing.js";
import type { PrivacySection } from "../privacy.js";

const IsoDate = z.iso.datetime({ offset: true });

export const LEGAL_TEXTS_API = "/api/v1/admin/legal-texts";
/**
 * The draft routes (create, update) carry up to 60 000 characters (the privacy policy), more than
 * the general 16 KB: UTF-8 (up to 3 bytes a character in the texts used) JSON-escaped plus the
 * envelope. Same limit in the admin proxy and the API.
 */
export const LEGAL_TEXT_MAX_BODY_BYTES = 256 * 1024;
export const LEGAL_TEXT_BODY_PATH =
  /^\/api\/v1\/admin\/legal-texts\/drafts(?:\/[0-9A-Fa-f-]{36})?$/;
export const PUBLIC_LEGAL_TEXTS_API = "/api/v1/public/legal-texts";

export const LEGAL_DOCUMENT_KEYS = [
  "PRIVACY_POLICY",
  "DOCUMENT_REQUEST_NOTICE",
  "CONTACT_NOTICE",
  "MARKETING_CONSENT",
  "AI_PROCESSING_NOTICE",
  "AI_PROCESSING_CONSENT",
  "INTERNATIONAL_TRANSFER_NOTICE",
  "INTERNATIONAL_TRANSFER_CONSENT",
] as const;
export const LegalDocumentKeySchema = z.enum(LEGAL_DOCUMENT_KEYS);
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

/** Notice = information (acknowledged, never "consent"); consent = optional, withdrawable. */
export type LegalTextKind = "POLICY" | "NOTICE" | "CONSENT";

export interface LegalDocumentDef {
  key: LegalDocumentKey;
  kind: LegalTextKind;
  title: string;
  /** Where the text is used; `null`: prepared for a future process, shown nowhere yet. */
  usedBy: string | null;
  purposes: readonly z.infer<typeof ProcessingPurposeIdSchema>[];
  maxChars: number;
}

export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentKey, LegalDocumentDef>> = {
  PRIVACY_POLICY: {
    key: "PRIVACY_POLICY",
    kind: "POLICY",
    title: "Privacy Policy",
    usedBy: "/privacy (BV and corporate site)",
    purposes: [
      "customer_communication",
      "quotation",
      "crm_record",
      "sales_management",
      "analytics",
      "marketing_email",
    ],
    maxChars: 60_000,
  },
  DOCUMENT_REQUEST_NOTICE: {
    key: "DOCUMENT_REQUEST_NOTICE",
    kind: "NOTICE",
    title: "PDF download data processing notice",
    usedBy: "Document request form (required acknowledgement)",
    purposes: ["customer_communication", "crm_record", "sales_management"],
    maxChars: 2_000,
  },
  CONTACT_NOTICE: {
    key: "CONTACT_NOTICE",
    kind: "NOTICE",
    title: "Contact & lead processing notice",
    usedBy: "Contact form (shown, no checkbox)",
    purposes: ["customer_communication", "quotation", "crm_record", "sales_management"],
    maxChars: 2_000,
  },
  MARKETING_CONSENT: {
    key: "MARKETING_CONSENT",
    kind: "CONSENT",
    title: "Optional marketing consent",
    usedBy: "Document request form (optional, unticked)",
    purposes: ["marketing_email"],
    maxChars: 1_000,
  },
  AI_PROCESSING_NOTICE: {
    key: "AI_PROCESSING_NOTICE",
    kind: "NOTICE",
    title: "AI-assisted processing notice",
    usedBy: null,
    purposes: ["ai_assisted_processing"],
    maxChars: 2_000,
  },
  AI_PROCESSING_CONSENT: {
    key: "AI_PROCESSING_CONSENT",
    kind: "CONSENT",
    title: "AI-assisted processing consent (only if the legal review requires consent)",
    usedBy: null,
    purposes: ["ai_assisted_processing"],
    maxChars: 1_000,
  },
  INTERNATIONAL_TRANSFER_NOTICE: {
    key: "INTERNATIONAL_TRANSFER_NOTICE",
    kind: "NOTICE",
    title: "International transfer notice",
    usedBy: null,
    purposes: ["international_transfer"],
    maxChars: 2_000,
  },
  INTERNATIONAL_TRANSFER_CONSENT: {
    key: "INTERNATIONAL_TRANSFER_CONSENT",
    kind: "CONSENT",
    title: "International transfer consent (exception only)",
    usedBy: null,
    purposes: ["international_transfer"],
    maxChars: 1_000,
  },
};

/** The four texts the public forms and the privacy page need, per language (LegalTextSet). */
export const FORM_LEGAL_DOCUMENTS = [
  "PRIVACY_POLICY",
  "DOCUMENT_REQUEST_NOTICE",
  "CONTACT_NOTICE",
  "MARKETING_CONSENT",
] as const satisfies readonly LegalDocumentKey[];

export const LEGAL_TEXT_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const LEGAL_REVIEW_STATES = ["REQUIRED", "APPROVED"] as const;

/** `<date>[.<n>].<locale>` (the CHECK of the evidence columns accepts the same form). */
export const LEGAL_TEXT_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$/;

const PersonSchema = z.strictObject({ id: UuidSchema, displayName: z.string() }).nullable();

export const LegalTextVersionSummarySchema = z.strictObject({
  id: UuidSchema,
  key: LegalDocumentKeySchema,
  locale: z.string(),
  /** Null while a draft (named when published). */
  version: z.string().nullable(),
  status: z.enum(LEGAL_TEXT_STATUSES),
  legalReview: z.enum(LEGAL_REVIEW_STATES),
  /** What the reviewers should check (shown in the editor; never published). */
  reviewNote: z.string().nullable(),
  /** Translation: the version of the source language it renders. */
  translatesVersion: z.string().nullable(),
  sha256: z.string(),
  createdAt: IsoDate,
  createdBy: PersonSchema,
  updatedAt: IsoDate,
  publishedAt: IsoDate.nullable(),
  publishedBy: PersonSchema,
  reviewApprovedAt: IsoDate.nullable(),
  reviewApprovedBy: PersonSchema,
  /** Optimistic concurrency of a draft. */
  revision: z.number().int().min(1),
});
export type LegalTextVersionSummary = z.infer<typeof LegalTextVersionSummarySchema>;

/**
 * DP-306: the text as it would be shown, filled by the same code as the sites
 * (legal-placeholders.ts): for the policy its markup with values filled, for a notice the words
 * that publication would freeze. `missing` names the placeholders without a value (shown as
 * "[pending: …]"), `placeholders` every placeholder the text uses.
 */
export const LegalTextPreviewSchema = z.strictObject({
  text: z.string(),
  placeholders: z.array(z.string()),
  missing: z.array(z.string()),
  /** Why publishing it now would be refused (`missing_value:<name>`), or null. */
  publicationProblem: z.string().nullable(),
});
export type LegalTextPreview = z.infer<typeof LegalTextPreviewSchema>;

export const LegalTextVersionDetailSchema = LegalTextVersionSummarySchema.extend({
  /**
   * The text. For the privacy policy, the editor markup (`policyToMarkup`): `## Title {#id}`
   * starts a section, blank lines separate paragraphs, `- ` starts a list item.
   */
  text: z.string(),
  preview: LegalTextPreviewSchema,
});
export type LegalTextVersionDetail = z.infer<typeof LegalTextVersionDetailSchema>;

export const LegalTextsOverviewSchema = z.strictObject({
  documents: z.array(
    z.strictObject({
      key: LegalDocumentKeySchema,
      locales: z.array(
        z.strictObject({
          locale: z.string(),
          current: LegalTextVersionSummarySchema.nullable(),
          draft: LegalTextVersionSummarySchema.nullable(),
        }),
      ),
    }),
  ),
  /** Languages offered for new texts (the site languages). */
  locales: z.array(z.string()),
  /** What still blocks production publication of the privacy page and the forms. */
  blockers: z.array(z.string()),
  permissions: z.strictObject({ edit: z.boolean(), publish: z.boolean() }),
});
export type LegalTextsOverview = z.infer<typeof LegalTextsOverviewSchema>;

export const LegalTextHistoryResponseSchema = z.strictObject({
  versions: z.array(LegalTextVersionSummarySchema).max(500),
});
export type LegalTextHistoryResponse = z.infer<typeof LegalTextHistoryResponseSchema>;

export const LegalTextVersionResponseSchema = z.strictObject({
  version: LegalTextVersionDetailSchema,
});
export type LegalTextVersionResponse = z.infer<typeof LegalTextVersionResponseSchema>;

const Text = z.string().max(60_000);
const ReviewNote = z.string().trim().max(2_000).nullable();

export const LegalTextDraftCreateRequestSchema = z.strictObject({
  key: LegalDocumentKeySchema,
  locale: z.string().regex(/^[a-z]{2}$/),
  text: Text,
  reviewNote: ReviewNote.default(null),
  /** For a translation: the published version of another language it renders. */
  translatesId: UuidSchema.nullable().default(null),
});
export type LegalTextDraftCreateRequest = z.infer<typeof LegalTextDraftCreateRequestSchema>;

export const LegalTextDraftUpdateRequestSchema = z.strictObject({
  text: Text,
  reviewNote: ReviewNote,
  revision: z.number().int().min(1),
});
export type LegalTextDraftUpdateRequest = z.infer<typeof LegalTextDraftUpdateRequestSchema>;

/** Publish exactly the text the publisher read (its SHA-256), never a later edit. */
export const LegalTextPublishRequestSchema = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const LegalTextReviewRequestSchema = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

// --- public snapshot (the sites read it with their proxy key) ------------------------------------

const PublicText = z.strictObject({ version: z.string(), text: z.string() });
export const PrivacySectionSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  list: z.array(z.string()).optional(),
});
export const PrivacySectionsSchema = z.array(PrivacySectionSchema);

/** One language whose four form texts are all published (else the language is not listed). */
export const PublicLegalTextSetSchema = z.strictObject({
  locale: z.string(),
  privacyNotice: PublicText,
  marketingConsent: PublicText,
  contactNotice: PublicText,
  privacyPolicy: z.strictObject({ version: z.string(), sections: z.array(PrivacySectionSchema) }),
  /** The source-language versions a translation renders (null for English). */
  translates: z
    .strictObject({
      privacyNotice: z.string(),
      marketingConsent: z.string(),
      contactNotice: z.string(),
      privacyPolicy: z.string(),
    })
    .nullable(),
});
export type PublicLegalTextSet = z.infer<typeof PublicLegalTextSetSchema>;

export const PublicLegalTextsResponseSchema = z.strictObject({
  sets: z.array(PublicLegalTextSetSchema),
  /**
   * DP-306: placeholders of the current policy of an offered language whose value is missing and
   * that are no blocker of their own (production gate). Older APIs send none.
   */
  missingValues: z
    .array(z.strictObject({ locale: z.string(), placeholder: z.string() }))
    .default([]),
  /** Legal review states of the current versions (the production gate). */
  pendingReview: z.array(
    z.strictObject({ key: LegalDocumentKeySchema, locale: z.string(), version: z.string() }),
  ),
});
export type PublicLegalTextsResponse = z.infer<typeof PublicLegalTextsResponseSchema>;

// --- privacy policy markup (the editor's plain text form of the sections) ------------------------

const SECTION_HEAD = /^##\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/;

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "section"
  );
}

/** Sections → markup. Paragraphs first, then the list (the page renders them in that order). */
export function policyToMarkup(sections: readonly PrivacySection[]): string {
  return sections
    .map((s) => {
      const parts = [`## ${s.title} {#${s.id}}`, ...s.paragraphs];
      if (s.list && s.list.length > 0) parts.push(s.list.map((i) => `- ${i}`).join("\n"));
      return parts.join("\n\n");
    })
    .join("\n\n");
}

export type PolicyMarkupResult =
  | { ok: true; sections: PrivacySection[] }
  | { ok: false; line: number; rule: "text_before_section" | "duplicate_id" | "empty" };

/** Markup → sections. Fails closed on text before the first section and on duplicate ids. */
export function policyFromMarkup(markup: string): PolicyMarkupResult {
  const sections: PrivacySection[] = [];
  const ids = new Set<string>();
  let para: string[] = [];
  const lines = markup.replace(/\r\n?/g, "\n").split("\n");
  const flush = () => {
    const cur = sections[sections.length - 1];
    if (cur && para.length > 0) cur.paragraphs.push(para.join(" "));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    const head = SECTION_HEAD.exec(line);
    if (head) {
      flush();
      const title = (head[1] as string).trim();
      const id = head[2] ?? slug(title);
      if (ids.has(id)) return { ok: false, line: i + 1, rule: "duplicate_id" };
      ids.add(id);
      sections.push({ id, title, paragraphs: [] });
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    const cur = sections[sections.length - 1];
    if (!cur) return { ok: false, line: i + 1, rule: "text_before_section" };
    if (line.startsWith("- ")) {
      flush();
      (cur.list ??= []).push(line.slice(2).trim());
      continue;
    }
    para.push(line);
  }
  flush();
  if (sections.length === 0) return { ok: false, line: 1, rule: "empty" };
  return { ok: true, sections };
}

/** The exact string whose SHA-256 identifies a policy version (sections as JSON). */
export function policyEvidenceText(sections: readonly PrivacySection[]): string {
  return JSON.stringify(
    sections.map((s) => ({
      id: s.id,
      title: s.title,
      paragraphs: s.paragraphs,
      ...(s.list ? { list: s.list } : {}),
    })),
  );
}
