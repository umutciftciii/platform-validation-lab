/**
 * DP-171: loads a research proposal dataset (docs/catalog/proposals/*.json) as content proposals,
 * through the admin API only (same client as the DP-157 catalogue import: the operator's own
 * session, product:edit of the site, audit and database rules apply to every call).
 *
 * Plan per dataset entry:
 *  - CREATE: the product is listed on the site and has no proposal for the locale yet;
 *  - SAME: a proposal exists with exactly this text and review data (nothing to do);
 *  - EXISTS_DIFFERENT: a proposal exists with other content. It is never overwritten; a revision
 *    is a reviewed change made in the console (or a later, separately approved run);
 *  - MISSING_PRODUCT: no product with this code is listed on the site (reported, never created).
 *
 * The tool never touches products, listings, texts, specifications, images, documents or
 * publications: it only calls POST /sites/:siteId/proposals.
 */
import { createHash } from "node:crypto";
import type {
  CatalogContextResponse,
  ProductListResponse,
  ProposalDataset,
  ProposalListResponse,
  ProposalResponse,
} from "@dream/contracts";
import type { AdminApi } from "../import/client.js";

export type ProposalPlanAction = "CREATE" | "SAME" | "EXISTS_DIFFERENT" | "MISSING_PRODUCT";

export interface ProposalPlanRow {
  code: string;
  action: ProposalPlanAction;
  productId: string | null;
  proposalId: string | null;
  hasText: boolean;
  items: number;
}

export interface ProposalImportReport {
  dp: "DP-171";
  site: { key: string; id: string };
  sourceRef: string;
  sourceSha256: string;
  mode: "dry-run" | "apply";
  counts: Record<ProposalPlanAction, number>;
  plan: ProposalPlanRow[];
  created: { code: string; proposalId: string }[];
  error: string | null;
}

/** Stable JSON (sorted keys) so that equal review data compares equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sha256Hex = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function planProposals(
  api: AdminApi,
  dataset: ProposalDataset,
  only: ReadonlySet<string> | null,
): Promise<{ site: { key: string; id: string }; plan: ProposalPlanRow[] }> {
  const ctx = await api.get<CatalogContextResponse>("/context");
  const site = ctx.sites.find((s) => s.key === dataset.site);
  if (!site) throw new Error(`the session cannot read the ${dataset.site} catalogue`);
  const products = new Map<string, string>();
  for (let page = 1; ; page++) {
    const r = await api.get<ProductListResponse>(
      `/products?siteId=${site.id}&pageSize=100&page=${page}&sort=code`,
    );
    for (const p of r.items) if (p.listing !== null) products.set(p.code, p.id);
    if (page * r.pageSize >= r.total || r.items.length === 0) break;
  }
  const existing = await api.get<ProposalListResponse>(`/proposals?siteId=${site.id}`);
  const byProduct = new Map(
    existing.proposals.filter((p) => p.locale === dataset.locale).map((p) => [p.productId, p]),
  );
  const plan: ProposalPlanRow[] = [];
  for (const entry of dataset.proposals) {
    if (only && !only.has(entry.code)) continue;
    const productId = products.get(entry.code) ?? null;
    const base = {
      code: entry.code,
      productId,
      hasText: entry.summary !== null || entry.description !== null,
      items: entry.reviewData.items.length,
    };
    if (!productId) {
      plan.push({ ...base, action: "MISSING_PRODUCT", proposalId: null });
      continue;
    }
    const found = byProduct.get(productId);
    if (!found) {
      plan.push({ ...base, action: "CREATE", proposalId: null });
      continue;
    }
    const detail = await api.get<ProposalResponse>(`/proposals/${found.id}`);
    const same =
      detail.proposal.summary === entry.summary &&
      detail.proposal.description === entry.description &&
      canonical(detail.proposal.reviewData) === canonical(entry.reviewData);
    plan.push({ ...base, action: same ? "SAME" : "EXISTS_DIFFERENT", proposalId: found.id });
  }
  return { site: { key: site.key, id: site.id }, plan };
}

export function countPlan(plan: readonly ProposalPlanRow[]): Record<ProposalPlanAction, number> {
  const counts = { CREATE: 0, SAME: 0, EXISTS_DIFFERENT: 0, MISSING_PRODUCT: 0 };
  for (const r of plan) counts[r.action] += 1;
  return counts;
}

export async function runProposals(
  api: AdminApi,
  dataset: ProposalDataset,
  sourceSha256: string,
  opts: { only: ReadonlySet<string> | null; apply: boolean; confirm: number | undefined },
  log: (line: string) => void = () => {},
): Promise<ProposalImportReport> {
  const { site, plan } = await planProposals(api, dataset, opts.only);
  const counts = countPlan(plan);
  const report: ProposalImportReport = {
    dp: "DP-171",
    site,
    sourceRef: dataset.sourceRef,
    sourceSha256,
    mode: opts.apply ? "apply" : "dry-run",
    counts,
    plan,
    created: [],
    error: null,
  };
  if (!opts.apply) return report;
  if (opts.confirm !== counts.CREATE) {
    report.error = `--confirm ${String(opts.confirm)} does not match the ${counts.CREATE} proposal(s) to create; run the dry run again`;
    return report;
  }
  const entries = new Map(dataset.proposals.map((p) => [p.code, p]));
  for (const row of plan.filter((r) => r.action === "CREATE")) {
    const e = entries.get(row.code)!;
    try {
      const res = await api.post<ProposalResponse>(`/sites/${site.id}/proposals`, {
        productId: row.productId,
        locale: dataset.locale,
        summary: e.summary,
        description: e.description,
        reviewData: e.reviewData,
        sourceRef: dataset.sourceRef,
        sourceSha256,
      });
      report.created.push({ code: row.code, proposalId: res.proposal.id });
      log(`created proposal for ${row.code}`);
    } catch (err) {
      report.error = `${row.code}: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }
  return report;
}
