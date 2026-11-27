/**
 * DP-210 (ADR-024 D7/D8): a published page, article or product that moves to a new address keeps
 * its old one as a 301. Called by the CMS and the catalogue inside the transaction that publishes
 * the content, after `lockSitePaths`, so the redirects change together with the publication or
 * not at all.
 *
 * One table (`SiteRedirect`) for every origin; this module writes SLUG_CHANGE rows only. The
 * rules, in the order they are applied:
 *
 *  0. An old address of other content (active SLUG_CHANGE redirect) is never taken: 409
 *     `old_address`; the 301 stays. Only the content that moved away may return to it.
 *  1. Live content takes an address back (its own old address, or a DP-211 manual redirect's
 *     source): that redirect is switched off (kept for history; never deleted).
 *  2. Older redirects that pointed at the previous address now point at the new one, so every old
 *     address is one hop from the content (A -> B, then B -> C: A -> C and B -> C; no chain).
 *  3. The previous address answers 301 with the new one.
 *  4. A loop is refused (409 `redirect_loop`). Rules 1-3 never build one, and the database trigger
 *     `SiteRedirect_no_chain` refuses chains (and so loops) for every writer, DP-211 included.
 *
 * Only the sites whose frontend applies redirects (contracts REDIRECT_SITE_KEYS: BV, and since COM-1
 * the corporate site) get redirects; elsewhere a slug change moves the address as before DP-210.
 * Products only on a site with catalogue routes (`keepsOldProductAddress`). Audit events name paths
 * only (no content).
 */
import { CATALOGUE_SITE_KEYS, REDIRECT_SITE_KEYS } from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { StaffAccess } from "../iam/staff/access.js";
import type { ScopedTx } from "../catalog/master.js";

export type RedirectContent = "CMS_PAGE" | "PRODUCT";

const RESOURCE = "site_redirect";
/** More hops than any valid redirect set can have (there are no chains at all). */
const MAX_HOPS = 20;

/** Whether the site's frontend applies redirects, from the caller's site list. */
export function keepsOldAddress(
  sites: readonly { id: string; key: string }[],
  siteId: string,
): boolean {
  const key = sites.find((s) => s.id === siteId)?.key;
  return key !== undefined && REDIRECT_SITE_KEYS.includes(key);
}

/**
 * COM-1: a product's old address is kept only on a site whose frontend has the catalogue routes
 * (contracts CATALOGUE_SITE_KEYS, the BV site): the corporate site applies redirects for its pages
 * but has no `/products/<slug>` address to keep.
 */
export function keepsOldProductAddress(
  sites: readonly { id: string; key: string }[],
  siteId: string,
): boolean {
  const key = sites.find((s) => s.id === siteId)?.key;
  return keepsOldAddress(sites, siteId) && key !== undefined && CATALOGUE_SITE_KEYS.includes(key);
}

/**
 * Serialises the changes of a site's live addresses: the first write of every publishing
 * transaction that may take or leave an address. A concurrent publication of the same site waits
 * here and then sees this one's addresses and redirects.
 */
export async function lockSitePaths(tx: ScopedTx, siteId: string): Promise<void> {
  // Locks the existing row (its UPDATE waits for a concurrent holder), or creates the row of a
  // site made after the migration; two first uses at the same moment: one answers 409, try again
  // (redirectDbError).
  await tx.sitePathLock.upsert({
    where: { siteId },
    create: { siteId },
    update: { version: { increment: 1 } },
    select: { siteId: true },
  });
}

export interface AddressChange {
  siteId: string;
  contentType: RedirectContent;
  contentId: string;
  /** The live address before this publication; null when the content was not live. */
  from: string | null;
  /** The live address after this publication. */
  to: string;
  /** The permission the publication was authorised with (audit metadata). */
  permission: string;
}

export interface AddressChangeResult {
  /** The redirect from the previous address, when one was written. */
  redirect: { sourcePath: string; target: string } | null;
  retargeted: number;
  retired: number;
}

const queryOf = (target: string) => {
  const i = target.indexOf("?");
  return i < 0 ? "" : target.slice(i);
};
const pathOf = (target: string) => target.split("?", 1)[0] ?? target;

/**
 * Applies rules 1-4 for content that is live at `to` after this transaction. Call after
 * `lockSitePaths` and only for a site where `keepsOldAddress` holds.
 */
export async function applyAddressChange(
  tx: ScopedTx,
  a: StaffAccess,
  change: AddressChange,
): Promise<AddressChangeResult> {
  const { siteId, to, from } = change;
  const audit = (action: string, id: string, metadata: Record<string, unknown>) =>
    a.audit(tx, {
      action,
      resourceType: RESOURCE,
      resourceId: id,
      siteId,
      permission: change.permission,
      metadata: { contentType: change.contentType, contentId: change.contentId, ...metadata },
    });

  // 0. An old address of other content is kept for it (301 stays): 409 old_address.
  await assertAddressFree(tx, siteId, to, change.contentType, change.contentId);
  // 1. The content returns to one of its own old addresses: that redirect is switched off.
  const taken = await tx.siteRedirect.findMany({
    where: { siteId, sourcePath: to, sourceQuery: "", active: true },
    select: { id: true, target: true, origin: true },
  });
  for (const r of taken) {
    await tx.siteRedirect.update({
      where: { id: r.id },
      data: { active: false, updatedById: a.userId, version: { increment: 1 } },
    });
    await audit("seo.redirect_retired", r.id, {
      sourcePath: to,
      target: r.target,
      origin: r.origin,
      reason: "address_live_again",
    });
  }
  const result: AddressChangeResult = { redirect: null, retargeted: 0, retired: taken.length };
  if (from === null || from === to) return result;

  // 2. No chain: what pointed at the previous address points at the new one.
  const pointing = await tx.siteRedirect.findMany({
    where: {
      siteId,
      active: true,
      OR: [{ target: from }, { target: { startsWith: `${from}?` } }],
    },
    select: { id: true, sourcePath: true, target: true },
  });
  for (const r of pointing) {
    if (pathOf(r.target) !== from) continue;
    const target = `${to}${queryOf(r.target)}`;
    await tx.siteRedirect.update({
      where: { id: r.id },
      data: { target, updatedById: a.userId, version: { increment: 1 } },
    });
    await audit("seo.redirect_retargeted", r.id, {
      sourcePath: r.sourcePath,
      previousTarget: r.target,
      target,
    });
    result.retargeted += 1;
  }

  // 3. The previous address answers 301 with the new one (one row per source: a redirect that
  // was switched off earlier is switched on again).
  const fields = {
    target: to,
    statusCode: 301,
    active: true,
    origin: "SLUG_CHANGE" as const,
    contentType: change.contentType,
    contentId: change.contentId,
    note: null,
    updatedById: a.userId,
  };
  const existing = await tx.siteRedirect.findUnique({
    where: { siteId_sourcePath_sourceQuery: { siteId, sourcePath: from, sourceQuery: "" } },
    select: { id: true },
  });
  const row = existing
    ? await tx.siteRedirect.update({
        where: { id: existing.id },
        data: { ...fields, version: { increment: 1 } },
        select: { id: true },
      })
    : await tx.siteRedirect.create({
        data: { siteId, sourcePath: from, sourceQuery: "", ...fields, createdById: a.userId },
        select: { id: true },
      });
  await audit(existing ? "seo.redirect_updated" : "seo.redirect_created", row.id, {
    sourcePath: from,
    target: to,
    origin: "SLUG_CHANGE",
    statusCode: 301,
  });
  result.redirect = { sourcePath: from, target: to };

  // 4. Belt and braces: the new address must not lead anywhere (it is live content now).
  await assertNoLoop(tx, siteId, from);
  return result;
}

/**
 * DP-210 (owner decision before merge): an address that answers 301 because a page, article or
 * product moved away (an active SLUG_CHANGE redirect) stays that content's old address. Only the
 * same content may take it again; any other content (or a new page, `contentId` null) is refused
 * with 409 `old_address`, so existing 301s are never lost. Checked when a draft takes the address
 * and again when it is published (after the site lock).
 */
export async function assertAddressFree(
  db: Pick<ScopedTx, "siteRedirect">,
  siteId: string,
  path: string | null,
  contentType: RedirectContent,
  contentId: string | null,
): Promise<void> {
  if (!path) return;
  const kept = await db.siteRedirect.findFirst({
    where: {
      siteId,
      sourcePath: path,
      sourceQuery: "",
      active: true,
      origin: "SLUG_CHANGE",
      NOT: contentId ? { contentType, contentId } : undefined,
    },
    select: { id: true },
  });
  if (kept) throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "old_address" }]);
}

/**
 * Follows the active redirects from `start`; 409 `redirect_loop` when a path repeats or the walk
 * does not end. Plain sources only (a query-bound redirect needs its query).
 */
export async function assertNoLoop(tx: ScopedTx, siteId: string, start: string): Promise<void> {
  const seen = new Set<string>([start]);
  let path = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = await tx.siteRedirect.findFirst({
      where: { siteId, sourcePath: path, sourceQuery: "", active: true },
      select: { target: true },
    });
    if (!next || !next.target.startsWith("/")) return;
    path = pathOf(next.target);
    if (seen.has(path)) {
      throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "redirect_loop" }]);
    }
    seen.add(path);
  }
  throw new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "redirect_loop" }]);
}

/** Active redirects that lead to a content item (its older addresses), oldest first. */
export async function redirectsTo(
  db: Pick<ScopedTx, "siteRedirect">,
  siteId: string,
  contentType: RedirectContent,
  contentId: string,
): Promise<string[]> {
  const rows = await db.siteRedirect.findMany({
    where: { siteId, contentType, contentId, active: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { sourcePath: true },
    take: 100,
  });
  return rows.map((r) => r.sourcePath);
}

/** The database refusals of the redirect table as API errors (CMS and catalogue mappers). */
export function redirectDbError(text: string): ApiError | null {
  if (/seo: a redirect (target|source) cannot be/.test(text)) {
    return new ApiError("CONFLICT_STATE", [{ path: "slug", rule: "redirect_loop" }]);
  }
  // Two first uses of a new site's lock row at once (when the upsert is not run natively): the
  // second one is asked to try again.
  if (/SitePathLock/.test(text) && /unique constraint|P2002/i.test(text)) {
    return new ApiError("CONFLICT_STATE", [{ path: "version", rule: "stale" }]);
  }
  return null;
}
