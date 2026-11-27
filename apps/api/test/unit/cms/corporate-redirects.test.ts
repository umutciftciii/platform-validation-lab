// COM-6: the redirect map of the old dreampetroleum.com (generated fixture of
// docs/cms/corporate-content/redirects) against the corporate content it points at: every target
// is an address of the corporate import set (English) or of its Turkish proposal, every source
// is an old address the admin import accepts, and no row starts a chain.
import { describe, expect, it } from "vitest";
import {
  CMS_SITE_REGISTRY,
  CORPORATE_TR_PROPOSAL_INDEX,
  parseRedirectSource,
  parseRedirectTarget,
  redirectSourceIsLegacy,
} from "@dream/contracts";
import {
  CORPORATE_LEGACY_INVENTORY,
  CORPORATE_REDIRECTS_CSV,
  CORPORATE_TR_PUBLIC_CSV,
} from "../../fixtures/corporate-legacy-map.js";

type Row = { source: string; target: string; status: string; active: string };
function rowsOf(csv: string): Row[] {
  const [header, ...lines] = csv.trimEnd().split("\n");
  expect(header).toBe("source,target,status,active,note");
  return lines.map((l) => {
    const [source = "", target = "", status = "", active = ""] = l.split(",");
    return { source, target, status, active };
  });
}

/** The English addresses of the corporate import set (designed pages, content pages, posts). */
const corporatePaths = new Set(
  CMS_SITE_REGISTRY.filter((e) => e.site === "CORPORATE" && e.path).map((e) => e.path as string),
);
const enPublic = (stored: string) => (stored === "/" ? "/en" : `/en${stored}`);
const now = rowsOf(CORPORATE_REDIRECTS_CSV);
const trPublic = rowsOf(CORPORATE_TR_PUBLIC_CSV);

describe("COM-6 corporate redirect map", () => {
  it("has one 301 row per old address, each a valid old-site source and site target", () => {
    expect(now).toHaveLength(163);
    expect(trPublic).toHaveLength(20);
    for (const rows of [now, trPublic]) {
      expect(new Set(rows.map((r) => r.source)).size).toBe(rows.length);
      for (const r of rows) {
        const s = parseRedirectSource(r.source);
        expect(s.ok, r.source).toBe(true);
        if (s.ok) expect(s.value).toEqual({ sourcePath: r.source, sourceQuery: "" });
        expect(redirectSourceIsLegacy(r.source), r.source).toBe(true);
        expect(parseRedirectTarget(r.target)).toEqual({ ok: true, value: r.target });
        expect([r.status, r.active]).toEqual(["301", "true"]);
      }
    }
  });

  it("sends every row to a page of the corporate import set, never through another row", () => {
    for (const r of now) {
      // Today every target is English (Turkish is not public): a stored address without prefix.
      expect(corporatePaths.has(r.target), `${r.source} -> ${r.target}`).toBe(true);
    }
    const sources = new Set([...now, ...trPublic].map((r) => r.source));
    for (const r of [...now, ...trPublic]) expect(sources.has(r.target), r.source).toBe(false);
    // The inventory says the same: a ROW's `now` is the row's target at its public address.
    const byInv = new Map(CORPORATE_LEGACY_INVENTORY.map((x) => [x.source, x]));
    for (const r of now) expect(byInv.get(r.source)?.now, r.source).toBe(enPublic(r.target));
  });

  it("maps each post in all six old languages to the same English post", () => {
    const articles = CORPORATE_LEGACY_INVENTORY.filter((x) => x.kind === "article");
    const perTarget = new Map<string, string[]>();
    for (const a of articles) perTarget.set(a.now, [...(perTarget.get(a.now) ?? []), a.lang]);
    expect(perTarget.size).toBe(19);
    // 18 posts in six languages, one (the 2026 outlook) without Spanish and German.
    const sizes = [...perTarget.values()].map((l) => l.length).sort();
    expect(sizes).toEqual([4, ...Array(18).fill(6)]);
    for (const langs of perTarget.values()) {
      expect(langs.filter((l) => l === "en" || l === "tr")).toHaveLength(2);
    }
  });

  it("sends the old Turkish posts to their Turkish proposal once Turkish is public", () => {
    const turkish = CORPORATE_LEGACY_INVENTORY.filter(
      (x) => x.lang === "tr" && x.kind === "article",
    );
    expect(turkish).toHaveLength(19);
    for (const t of turkish) {
      const en = t.now.slice("/en".length) as `/news/${string}`;
      const proposal = CORPORATE_TR_PROPOSAL_INDEX[`article|${en}`];
      expect(proposal, en).toBeDefined();
      expect(t.trPublic).toBe(`/tr/news/${proposal!.slug}`);
      expect(trPublic.find((r) => r.source === t.source)?.target).toBe(t.trPublic);
    }
    // The Turkish contact page's old proposal address keeps working (COM-6 slug fix).
    expect(trPublic.find((r) => r.source === "/tr/iletisim")?.target).toBe("/tr/contact");
    const contact = CORPORATE_LEGACY_INVENTORY.find((x) => x.source === "/contact-us");
    expect(contact).toMatchObject({
      decision: "SITE_RULE",
      now: "/en/contact",
      trPublic: "/tr/contact",
    });
  });

  it("keeps the new site's own English addresses and leaves the unprefixed ones to the site rule", () => {
    const keep = CORPORATE_LEGACY_INVENTORY.filter((x) => x.decision === "KEEP");
    expect(keep.map((x) => x.source).sort()).toEqual(
      [
        "/en",
        "/en/about-us",
        "/en/energy-trading",
        "/en/logistics",
        "/en/our-team",
        "/en/products",
        "/en/storage-distribution",
        "/en/strategic-partnership",
        "/en/sustainability",
      ].sort(),
    );
    for (const k of keep) expect(corporatePaths.has(k.source.slice(3) || "/"), k.source).toBe(true);
    const rule = CORPORATE_LEGACY_INVENTORY.filter((x) => x.decision === "SITE_RULE");
    expect(rule).toHaveLength(12);
    expect(rule.every((x) => x.lang === "tr" && x.source.split("/").length === 2)).toBe(true);
  });
});
