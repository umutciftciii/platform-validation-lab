/**
 * Which products are live on a public site (PM-3), shared by the public catalogue and the lead
 * flow (DP-042): a publication of this site is PUBLISHED, its listing VISIBLE and the master not
 * ARCHIVED. Plain functions over the site-scoped client, no Nest wiring.
 */
import type { PublicSite } from "../iam/public-site.js";

export interface LiveRow {
  productId: string;
  listingId: string;
  snapshot: unknown;
  publishedAt: Date;
}

export async function liveRows(
  site: PublicSite,
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

export interface LeadDocumentTarget {
  documentId: string;
  productId: string;
  revisionId: string;
}

/**
 * A `LEAD_REQUIRED` document this site lists right now (ADR-016 D1 = ADR-014 D4): shown by the
 * site's publisher with a pinned revision, ACTIVE, and its product live here. Null otherwise.
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
    select: { id: true, productId: true, status: true, accessPolicy: true },
  });
  if (!doc || doc.status !== "ACTIVE" || doc.accessPolicy !== "LEAD_REQUIRED") return null;
  const [live] = await liveRows(site, { productId: doc.productId });
  if (!live) return null;
  return { documentId: doc.id, productId: doc.productId, revisionId: shown.revisionId };
}
