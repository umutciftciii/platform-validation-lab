/**
 * DP-180: copies the customer text of the site's research proposals (DP-171) into the products'
 * listing texts on that site, through the admin API only (the operator's own session,
 * `product:edit` of the site; authorisation, audit, versions and database rules apply to every
 * call as to a person in the console).
 *
 * Plan per product listed on the site (dry run by default):
 *  - APPLY: the listing's summary and description are empty (or already equal) where the
 *    proposal has text, and at least one of them is still empty: they get the proposal's text;
 *  - SAME: the listing already carries exactly the proposal's text (nothing to do);
 *  - KEEP_EXISTING: the listing has another summary or description; it is never overwritten;
 *  - NO_TEXT: there is no proposal, or the proposal has no customer text (e.g. SAF,
 *    LUB-GENERIC: no text is ever generated);
 *  - SKIP: the product is archived or published on the site (a live product changes only by a
 *    reviewed republication);
 *  - STALE: at apply time the listing or the proposal changed since the plan (not written).
 *
 * Only `summary` and `description` change. The listing's title, category, sort order and
 * visibility are sent back unchanged; nothing is published. Each write names the proposal, its
 * version and the SHA-256 of its text (`source`), which the API checks and keeps in the audit
 * event. Running it again after an apply yields SAME for every applied product.
 */
import { createHash } from "node:crypto";
import {
  proposalContentKey,
  type CatalogContextResponse,
  type ListingResponse,
  type ListingUpsertRequest,
  type ProductDetailResponse,
  type ProductListResponse,
  type ProductWorkflowResponse,
  type ProposalListResponse,
  type ProposalResponse,
} from "@dream/contracts";
import { AdminApiError, type AdminApi } from "../import/client.js";

export const APPLY_TEXT_ACTIONS = [
  "APPLY",
  "SAME",
  "KEEP_EXISTING",
  "NO_TEXT",
  "SKIP",
  "STALE",
] as const;
export type ApplyTextAction = (typeof APPLY_TEXT_ACTIONS)[number];

export interface ApplyTextRow {
  code: string;
  action: ApplyTextAction;
  productId: string;
  /** Why SKIP, KEEP_EXISTING, NO_TEXT or STALE. */
  reason: string | null;
  listingId: string | null;
  listingVersion: number | null;
  proposalId: string | null;
  proposalVersion: number | null;
  proposalStatus: string | null;
  textSha256: string | null;
  /** The fields an APPLY fills. */
  fills: ("summary" | "description")[];
}

export interface ApplyTextReport {
  dp: "DP-180";
  site: { key: string; id: string };
  locale: string;
  mode: "dry-run" | "apply";
  counts: Record<ApplyTextAction, number>;
  plan: ApplyTextRow[];
  applied: { code: string; listingVersion: number }[];
  error: string | null;
}

export const textSha256 = (summary: string | null, description: string | null) =>
  createHash("sha256").update(proposalContentKey(summary, description), "utf8").digest("hex");

interface Listed {
  id: string;
  code: string;
  status: string;
}

/** Everything the decision needs for one product, read fresh from the API. */
interface ProductState {
  detail: ProductDetailResponse;
  live: boolean;
  proposal: ProposalResponse["proposal"] | null;
}

async function readState(
  api: AdminApi,
  siteId: string,
  productId: string,
  proposalId: string | null,
): Promise<ProductState> {
  const [detail, workflow, proposal] = await Promise.all([
    api.get<ProductDetailResponse>(`/products/${productId}?siteId=${siteId}`),
    api.get<ProductWorkflowResponse>(`/products/${productId}/workflow`),
    proposalId
      ? api.get<ProposalResponse>(`/proposals/${proposalId}`).then((r) => r.proposal)
      : Promise.resolve(null),
  ]);
  const live = workflow.sites.some(
    (s) => s.siteId === siteId && s.publication?.status === "PUBLISHED",
  );
  return { detail, live, proposal };
}

/** The decision for one product (pure: the unit tests drive it directly). */
export function decide(code: string, productId: string, state: ProductState): ApplyTextRow {
  const { detail, live, proposal } = state;
  const l = detail.listing;
  const row: ApplyTextRow = {
    code,
    action: "NO_TEXT",
    productId,
    reason: null,
    listingId: l?.id ?? null,
    listingVersion: l?.version ?? null,
    proposalId: proposal?.id ?? null,
    proposalVersion: proposal?.version ?? null,
    proposalStatus: proposal?.status ?? null,
    textSha256: proposal ? textSha256(proposal.summary, proposal.description) : null,
    fills: [],
  };
  if (detail.product.status === "ARCHIVED") return { ...row, action: "SKIP", reason: "archived" };
  if (live) return { ...row, action: "SKIP", reason: "published" };
  if (!l) return { ...row, action: "SKIP", reason: "not_listed" };
  if (!proposal) return { ...row, action: "NO_TEXT", reason: "no_proposal" };
  if (proposal.summary === null && proposal.description === null) {
    return { ...row, action: "NO_TEXT", reason: "proposal_without_text" };
  }
  const current = { summary: l.text?.summary ?? null, description: l.text?.description ?? null };
  const fills: ("summary" | "description")[] = [];
  for (const f of ["summary", "description"] as const) {
    const want = proposal[f];
    if (want === null) continue; // the proposal has nothing for this field: keep the listing's
    if (current[f] === want) continue;
    if (current[f] !== null) {
      return { ...row, action: "KEEP_EXISTING", reason: `${f}_differs` };
    }
    fills.push(f);
  }
  if (fills.length === 0) return { ...row, action: "SAME" };
  return { ...row, action: "APPLY", fills };
}

export function countPlan(plan: readonly ApplyTextRow[]): Record<ApplyTextAction, number> {
  const counts = Object.fromEntries(APPLY_TEXT_ACTIONS.map((a) => [a, 0])) as Record<
    ApplyTextAction,
    number
  >;
  for (const r of plan) counts[r.action] += 1;
  return counts;
}

export async function planApplyText(
  api: AdminApi,
  siteKey: string,
  locale: string,
  only: ReadonlySet<string> | null,
): Promise<{ site: { key: string; id: string }; plan: ApplyTextRow[] }> {
  const ctx = await api.get<CatalogContextResponse>("/context");
  const site = ctx.sites.find((s) => s.key === siteKey);
  if (!site) throw new Error(`the session cannot read the ${siteKey} catalogue`);
  if (!site.canEdit) throw new Error(`the session cannot edit ${siteKey} listings (product:edit)`);
  const listed: Listed[] = [];
  for (let page = 1; ; page++) {
    const r = await api.get<ProductListResponse>(
      `/products?siteId=${site.id}&pageSize=100&page=${page}&sort=code&listing=listed`,
    );
    for (const p of r.items) listed.push({ id: p.id, code: p.code, status: p.status });
    if (page * r.pageSize >= r.total || r.items.length === 0) break;
  }
  const proposals = await api.get<ProposalListResponse>(`/proposals?siteId=${site.id}`);
  const proposalOf = new Map(
    proposals.proposals.filter((p) => p.locale === locale).map((p) => [p.productId, p.id]),
  );
  const plan: ApplyTextRow[] = [];
  for (const p of listed.sort((a, b) => a.code.localeCompare(b.code))) {
    if (only && !only.has(p.code)) continue;
    const state = await readState(api, site.id, p.id, proposalOf.get(p.id) ?? null);
    plan.push(decide(p.code, p.id, state));
  }
  return { site: { key: site.key, id: site.id }, plan };
}

export async function runApplyText(
  api: AdminApi,
  opts: {
    siteKey: string;
    locale: string;
    only: ReadonlySet<string> | null;
    apply: boolean;
    confirm: number | undefined;
  },
  log: (line: string) => void = () => {},
): Promise<ApplyTextReport> {
  const { site, plan } = await planApplyText(api, opts.siteKey, opts.locale, opts.only);
  const report: ApplyTextReport = {
    dp: "DP-180",
    site,
    locale: opts.locale,
    mode: opts.apply ? "apply" : "dry-run",
    counts: countPlan(plan),
    plan,
    applied: [],
    error: null,
  };
  if (!opts.apply) return report;
  const toApply = plan.filter((r) => r.action === "APPLY");
  if (opts.confirm !== toApply.length) {
    report.error = `--confirm ${String(opts.confirm)} does not match the ${toApply.length} listing(s) to fill; run the dry run again`;
    return report;
  }
  for (const row of toApply) {
    // Read again: anything changed since the plan is STALE and left alone.
    const now = decide(
      row.code,
      row.productId,
      await readState(api, site.id, row.productId, row.proposalId),
    );
    if (
      now.action !== "APPLY" ||
      now.listingVersion !== row.listingVersion ||
      now.proposalVersion !== row.proposalVersion ||
      now.textSha256 !== row.textSha256
    ) {
      Object.assign(row, { action: "STALE", reason: `changed_since_plan:${now.action}` });
      log(`stale: ${row.code} (${now.action})`);
      continue;
    }
    const detail = await api.get<ProductDetailResponse>(
      `/products/${row.productId}?siteId=${site.id}`,
    );
    const l = detail.listing!;
    const proposal = (await api.get<ProposalResponse>(`/proposals/${row.proposalId!}`)).proposal;
    const body: ListingUpsertRequest = {
      version: l.version,
      categoryId: l.categoryId,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      title: l.text?.title ?? null,
      summary: proposal.summary ?? l.text?.summary ?? null,
      description: proposal.description ?? l.text?.description ?? null,
      source: {
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        textSha256: row.textSha256!,
      },
    };
    try {
      const res = await api.post<ListingResponse>(
        `/products/${row.productId}/listings/${site.id}`,
        body,
      );
      report.applied.push({ code: row.code, listingVersion: res.listing.version });
      log(`filled ${row.fills.join(" + ")} of ${row.code}`);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409) {
        Object.assign(row, { action: "STALE", reason: "conflict_409" });
        log(`stale: ${row.code} (409)`);
        continue;
      }
      report.error = `${row.code}: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }
  report.counts = countPlan(plan);
  return report;
}
