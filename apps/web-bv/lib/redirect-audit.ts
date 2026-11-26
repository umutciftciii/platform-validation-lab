/**
 * ML-3 (DP-236, ADR-028 D5, R-37): proxy rules and database redirects evaluated TOGETHER.
 *
 * `simulatedResolve` answers `GET /seo/resolve` the way the API does (DP-207/210/211/212, ML-2):
 * live content first, then a redirect bound to the exact query, then the plain redirect of the
 * path; an address outside the site's own forms is looked up as an old-site address only; a
 * language that is not public is 404. `auditRedirects` sends every redirect source (and every
 * unprefixed and prefixed form of the site's addresses) through the real `decide` of the proxy with
 * that simulated API and reports, per request, the final answer and the hops a visitor would see.
 *
 * Used by the tests (the 83 DEV rows of DP-212, synthetic cycles and chains) and meant for ML-4:
 * a new map is checked offline against the live addresses before any DEV import (dry-run).
 * Pure: no Next.js, no fetch.
 */
import { SEO_RESOLVABLE_PATH, normalizeRedirectQuery, seoLegacyPath } from "@dream/contracts";

import { DEFAULT_LOCALE, localePath, type RouteLocale } from "./locale-routing.ts";
import {
  decideRequest,
  type ProxyDeps,
  type RequestDecision,
  type ResolveAnswer,
} from "./proxy-routes.ts";

export interface RedirectRow {
  /** Stored source path (lower case) and query (normalised, "" for none). */
  sourcePath: string;
  sourceQuery: string;
  target: string;
  statusCode: 301 | 302;
}

export interface SiteState {
  rows: readonly RedirectRow[];
  /** Stored addresses with live content: `/about-us`, `/products/x`, `/nl/over-ons`. */
  live: ReadonlySet<string>;
  publicLocales: readonly string[];
}

/** A redirect row as the admin import stores it (DP-212 CSV: `source,target,status,active`). */
export function rowFromCsv(source: string, target: string, status: string): RedirectRow {
  const q = source.indexOf("?");
  const path = (q === -1 ? source : source.slice(0, q)).toLowerCase();
  const query = normalizeRedirectQuery(q === -1 ? "" : source.slice(q + 1));
  if (!query.ok) throw new Error(`rowFromCsv: query of ${source}`);
  return {
    sourcePath: path,
    sourceQuery: query.value,
    target,
    statusCode: status === "302" ? 302 : 301,
  };
}

/** Parses the DP-212 import CSV (no quoted commas in source/target/status/active). */
export function parseRedirectCsv(text: string): RedirectRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [header, ...rows] = lines;
  if (!header?.startsWith("source,target,status,active")) throw new Error("not a redirect CSV");
  return rows
    .map((l) => l.split(","))
    .filter((c) => c[3] === "true")
    .map((c) => rowFromCsv(c[0] ?? "", c[1] ?? "", c[2] ?? "301"));
}

/** The API's resolve, simulated on a site state (see the module comment). */
export function simulatedResolve(site: SiteState) {
  return async (path: string, search: string, locale?: RouteLocale): Promise<ResolveAnswer> => {
    const loc = locale ?? DEFAULT_LOCALE;
    if (!site.publicLocales.includes(loc)) return { status: "not_found" };
    const legacy =
      SEO_RESOLVABLE_PATH.test(path) || path.endsWith("/") ? null : seoLegacyPath(path);
    if (!SEO_RESOLVABLE_PATH.test(path) && !legacy) return { status: "not_found" };
    const first = path.split("/")[1]?.toLowerCase() ?? "";
    if (["nl", "en"].includes(first) && !site.publicLocales.includes(first)) {
      return { status: "not_found" };
    }
    // The stored address of the language (ML-2 cmsLocaleAddress).
    const address = legacy ?? (loc === DEFAULT_LOCALE ? path : localePath(loc, path));
    if (!legacy && site.live.has(address)) return { status: "found" };
    const q = normalizeRedirectQuery(search);
    const query = q.ok ? q.value : "";
    const bound = query
      ? site.rows.find((r) => r.sourcePath === address && r.sourceQuery === query)
      : undefined;
    if (bound) {
      return {
        status: "redirect",
        target: bound.target,
        statusCode: bound.statusCode,
        keepQuery: false,
      };
    }
    const plain = site.rows.find((r) => r.sourcePath === address && r.sourceQuery === "");
    if (plain) return { status: "redirect", target: plain.target, statusCode: plain.statusCode };
    return { status: "not_found" };
  };
}

export function simulatedDeps(site: SiteState, loops: string[][] = []): ProxyDeps {
  return {
    resolve: simulatedResolve(site),
    publicLocales: async () => site.publicLocales,
    documents: async () => ({ ok: false, reason: "not_found" }),
    // ML-8c: the audit simulates addresses only; another language's catalogue has no product.
    catalogue: async () => "empty",
    privacyPublished: true,
    // DP-298: the policy's languages are the API's; the audit assumes the English one only (the
    // seed), as the site had before Dutch is published.
    privacyLocales: [DEFAULT_LOCALE],
    onLoop: (trail) => loops.push([...trail]),
  };
}

export interface AuditEntry {
  request: string;
  decision: RequestDecision;
  /** What the visitor's browser sees after following the answer (at most `limit` requests). */
  hops: string[];
  /** The status of each hop (301/302, or 308 for the trailing-slash normalisation). */
  statuses: number[];
  /**
   * `refused`: the proxy found a cycle (or an over-long chain) and answered its 404 instead;
   * `loop`: the browser would go round in circles — must never happen.
   */
  final: "page" | "not-found" | "external" | "refused" | "loop";
}

/**
 * Follows a request like a browser would (redirect after redirect, up to `limit`) through the
 * real proxy answer (`decideRequest`, trailing slash included). A correct site answers every
 * request with at most ONE redirect.
 */
export async function follow(site: SiteState, request: string, limit = 6): Promise<AuditEntry> {
  const loops: string[][] = [];
  const deps = simulatedDeps(site, loops);
  const hops: string[] = [];
  const statuses: number[] = [];
  let url = request;
  let first: RequestDecision | null = null;
  for (let i = 0; i < limit; i++) {
    const q = url.indexOf("?");
    const pathname = q === -1 ? url : url.slice(0, q);
    const search = q === -1 ? "" : url.slice(q);
    const d = await decideRequest(pathname, search, "GET", deps);
    first ??= d;
    if (d.action === "next") return { request, decision: first, hops, statuses, final: "page" };
    if (d.action === "not-found") {
      const final = loops.length ? "refused" : "not-found";
      return { request, decision: first, hops, statuses, final };
    }
    statuses.push(d.status);
    if (!d.location.startsWith("/")) {
      hops.push(d.location);
      return { request, decision: first, hops, statuses, final: "external" };
    }
    if (hops.includes(d.location) || d.location === request) {
      hops.push(d.location);
      return { request, decision: first, hops, statuses, final: "loop" };
    }
    hops.push(d.location);
    url = d.location;
  }
  return { request, decision: first as RequestDecision, hops, statuses, final: "loop" };
}

/** Every redirect source of the map (with its query) as a request. */
export function sourcesOf(rows: readonly RedirectRow[]): string[] {
  return rows.map((r) => (r.sourceQuery ? `${r.sourcePath}?${r.sourceQuery}` : r.sourcePath));
}

/**
 * Requests the audit sends: every source, and every live address unprefixed and under `/en`, each
 * also with a trailing slash (ML-4: one hop with the slash as well).
 */
export function auditRequests(site: SiteState): string[] {
  const live = [...site.live].filter((a) => !a.startsWith("/nl"));
  const addresses = [
    ...sourcesOf(site.rows),
    ...live,
    ...live.map((a) => localePath(DEFAULT_LOCALE, a)),
  ];
  const slashed = addresses.filter((a) => a !== "/").map((a) => a.replace(/(\?|$)/, "/$1"));
  return [...new Set(["/", ...addresses, ...slashed])];
}

export async function auditRedirects(site: SiteState): Promise<AuditEntry[]> {
  const out: AuditEntry[] = [];
  for (const r of auditRequests(site)) out.push(await follow(site, r));
  return out;
}
