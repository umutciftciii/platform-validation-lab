/**
 * Which products are live on a public site (PM-3), shared by the public catalogue and the lead
 * flow (DP-042): a publication of this site is PUBLISHED, its listing VISIBLE and the master not
 * ARCHIVED. Plain functions over the site-scoped client, no Nest wiring.
 */
import { siteLocalesOf } from "../cms/site-locales.js";
import type { PublicSite } from "../iam/public-site.js";

export interface LiveRow {
  productId: string;
  listingId: string;
  snapshot: unknown;
  publishedAt: Date;
}

export async function liveRows(
  site: Pick<PublicSite, "db" | "siteId">,
  where: Record<string, unknown> = {},
): Promise<LiveRow[]> {
  const rows = await site.db.productPublication.findMany({
    where: {
      siteId: site.siteId,
      status: "PUBLISHED",
      product: { status: { not: "ARCHIVED" } },
      ...where,
    },
    select: { productId: true, listingId: true, snapshot: true, publishedAt: true },
    take: 500,
  });
  if (rows.length === 0) return [];
  const visible = await site.db.productSiteListing.findMany({
    where: {
      siteId: site.siteId,
      visibility: "VISIBLE",
      id: { in: rows.map((r) => r.listingId) },
    },
    select: { id: true },
  });
  const ok = new Set(visible.map((l) => l.id));
  return rows.filter((r) => ok.has(r.listingId));
}

/**
 * ML-9 (ADR-028 D10): the document languages visitors of this site may get — enabled and public
 * there (SiteLocale) — and the site's default language (always public; the database ensures it).
 * A document in any other language is never listed, downloaded or requested on the site, even
 * when its publisher shows it, so a Dutch file stays closed while `nl` is not public.
 */
export async function publicDocumentLanguages(
  site: Pick<PublicSite, "db" | "siteId">,
): Promise<{ defaultLocale: string | null; languages: Set<string> }> {
  const all = (await siteLocalesOf(site.db, [site.siteId])).get(site.siteId) ?? [];
  const open = all.filter((l) => l.enabled && l.public);
  return {
    defaultLocale: open.find((l) => l.isDefault)?.locale ?? null,
    languages: new Set(open.map((l) => l.locale)),
  };
}

/**
 * ML-9: the languages of the documents a page in `pageLocale` lists: its own language and, as the
 * fallback, the site's default language (ADR-028 D10: the English file with an "English" label).
 * Both must be public (the page locale already is, ML-8c).
 */
export function pageDocumentLanguages(
  open: { defaultLocale: string | null; languages: Set<string> },
  pageLocale: string,
): string[] {
  const out = [pageLocale, open.defaultLocale].filter(
    (l): l is string => l !== null && open.languages.has(l),
  );
  return [...new Set(out)];
}

export interface LeadDocumentTarget {
  documentId: string;
  productId: string;
  revisionId: string;
}

/**
 * A `LEAD_REQUIRED` document this site lists right now (ADR-016 D1 = ADR-014 D4): shown by the
 * site's publisher with a pinned revision, ACTIVE, its product live here and (ML-9) its language
 * public on the site. Null otherwise.
 */
export async function leadDocumentOnSite(
  site: PublicSite,
  documentId: string,
): Promise<LeadDocumentTarget | null> {
  const shown = await site.db.productDocumentSite.findFirst({
    where: { siteId: site.siteId, documentId },
    select: { revisionId: true },
  });
  if (!shown) return null;
  const doc = await site.db.productDocument.findUnique({
    where: { id: documentId },
    select: { id: true, productId: true, status: true, accessPolicy: true, language: true },
  });
  if (!doc || doc.status !== "ACTIVE" || doc.accessPolicy !== "LEAD_REQUIRED") return null;
  if (!(await publicDocumentLanguages(site)).languages.has(doc.language)) return null;
  const [live] = await liveRows(site, { productId: doc.productId });
  if (!live) return null;
  return { documentId: doc.id, productId: doc.productId, revisionId: shown.revisionId };
}
