/**
 * DP-298 (ADR-031 D1): the published legal texts, read from `LegalTextVersion`. The ONLY runtime
 * source of the form texts, the privacy pages and the evidence check (the constants of
 * @dream/contracts are the seed of the migration).
 *
 * - The newest published version of a document and language is its current one.
 * - A language is offered when all four form texts (policy, document notice, contact notice,
 *   marketing consent) are published in it; otherwise it has no forms and no policy page.
 * - `pendingReview` lists the current versions of the offered languages whose legal review is not
 *   recorded: the production gate (`privacyBlockersFor`).
 * Read on every use (one indexed query): a version published on one API instance is current on
 * every instance at once, and the evidence check never disagrees with what a site was served.
 */
import { createHash } from "node:crypto";
import {
  FORM_LEGAL_DOCUMENTS,
  PRIVACY_FILL_LABELS,
  PRIVACY_FILL_LABELS_EN,
  policyMissingValues,
  PrivacySectionsSchema,
  legalTextRegistryFrom,
  privacyBlockersFor,
  type LegalDocumentKey,
  type LegalTextRegistry,
  type PrivacySection,
  type PublicLegalTextSet,
  type PublicLegalTextsResponse,
} from "@dream/contracts";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const SectionsSchema = PrivacySectionsSchema;

export interface PublishedRow {
  id: string;
  key: LegalDocumentKey;
  locale: string;
  version: string | null;
  legalReview: "REQUIRED" | "APPROVED";
  text: string;
  sections: unknown;
  translatesId: string | null;
  publishedAt: Date | null;
}

export const PUBLISHED_SELECT = {
  id: true,
  key: true,
  locale: true,
  version: true,
  legalReview: true,
  text: true,
  sections: true,
  translatesId: true,
  publishedAt: true,
} as const;

/** Any client that can read the table (the site-scoped clients and staff transactions can). */
export interface LegalTextReader {
  legalTextVersion: {
    findMany(args: {
      where: { status: "PUBLISHED" };
      orderBy: { publishedAt?: "desc"; version?: "desc" }[];
      select: typeof PUBLISHED_SELECT;
    }): Promise<PublishedRow[]>;
  };
}

export interface PublishedTexts {
  sets: PublicLegalTextSet[];
  pendingReview: PublicLegalTextsResponse["pendingReview"];
  /** DP-306: missing values of the current policies that are no blocker of their own. */
  missingValues: PublicLegalTextsResponse["missingValues"];
  registry: LegalTextRegistry;
  blockers: string[];
  /** Current published version per `key|locale`. */
  current: Map<string, PublishedRow>;
}

const FORM: readonly LegalDocumentKey[] = FORM_LEGAL_DOCUMENTS;

export function currentKey(key: LegalDocumentKey, locale: string): string {
  return `${key}|${locale}`;
}

/** Builds the snapshot from the published rows (pure; newest first per document and language). */
export function publishedTextsFrom(rows: readonly PublishedRow[]): PublishedTexts {
  const current = new Map<string, PublishedRow>();
  const versionOf = new Map<string, string>();
  for (const r of rows) {
    if (r.version) versionOf.set(r.id, r.version);
    const k = currentKey(r.key, r.locale);
    const seen = current.get(k);
    if (!seen || (r.publishedAt?.getTime() ?? 0) > (seen.publishedAt?.getTime() ?? 0)) {
      current.set(k, r);
    }
  }
  const locales = [...new Set(rows.map((r) => r.locale))].sort();
  const sets: PublicLegalTextSet[] = [];
  const pendingReview: PublicLegalTextsResponse["pendingReview"] = [];
  const missingValues: PublicLegalTextsResponse["missingValues"] = [];
  for (const locale of locales) {
    const get = (key: LegalDocumentKey) => current.get(currentKey(key, locale));
    const policy = get("PRIVACY_POLICY");
    const notice = get("DOCUMENT_REQUEST_NOTICE");
    const contact = get("CONTACT_NOTICE");
    const marketing = get("MARKETING_CONSENT");
    if (!policy || !notice || !contact || !marketing) continue;
    const sections = SectionsSchema.safeParse(policy.sections);
    if (!sections.success) continue; // fail closed: a broken policy offers nothing
    const tr = (r: PublishedRow) => (r.translatesId ? versionOf.get(r.translatesId) : undefined);
    const translates =
      locale === "en"
        ? null
        : (() => {
            const t = [tr(notice), tr(marketing), tr(contact), tr(policy)];
            return t.every((v) => v !== undefined)
              ? {
                  privacyNotice: t[0] as string,
                  marketingConsent: t[1] as string,
                  contactNotice: t[2] as string,
                  privacyPolicy: t[3] as string,
                }
              : null;
          })();
    sets.push({
      locale,
      privacyNotice: { version: notice.version as string, text: notice.text },
      marketingConsent: { version: marketing.version as string, text: marketing.text },
      contactNotice: { version: contact.version as string, text: contact.text },
      privacyPolicy: {
        version: policy.version as string,
        sections: sections.data as PrivacySection[],
      },
      translates,
    });
    // DP-306: a value the current policy uses but nobody supplied (e.g. {kvkkContact}).
    for (const placeholder of policyMissingValues(sections.data as PrivacySection[], {
      labels: PRIVACY_FILL_LABELS[locale] ?? PRIVACY_FILL_LABELS_EN,
      version: policy.version,
    })) {
      missingValues.push({ locale, placeholder });
    }
    for (const key of FORM) {
      const r = get(key) as PublishedRow;
      if (r.legalReview !== "APPROVED") {
        pendingReview.push({ key, locale, version: r.version as string });
      }
    }
  }
  return {
    sets,
    pendingReview,
    missingValues,
    registry: legalTextRegistryFrom(sets),
    blockers: privacyBlockersFor(pendingReview, undefined, undefined, missingValues),
    current,
  };
}

export async function loadPublishedTexts(db: unknown): Promise<PublishedTexts> {
  const rows = await (db as LegalTextReader).legalTextVersion.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    select: PUBLISHED_SELECT,
  });
  return publishedTextsFrom(rows);
}
