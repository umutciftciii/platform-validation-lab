// COM-6: every address of the old dreampetroleum.com through the corporate proxy, with the real
// import files (generated fixture) behind a resolve API that answers like the real one: one 301
// to the address's own content, no chain, no loop, the new site's own addresses untouched.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORPORATE_LEGACY_INVENTORY,
  CORPORATE_REDIRECTS_CSV,
  CORPORATE_TR_PUBLIC_CSV,
} from "./corporate-legacy-map.fixture.ts";
import type { RouteLocale } from "./locale-routing.ts";
import { decideRequest, type ProxyDeps, type ResolveAnswer } from "./proxy-routes.ts";

function rowsOf(csv: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of csv.trimEnd().split("\n").slice(1)) {
    const [source = "", target = ""] = line.split(",");
    rows.set(source, target);
  }
  return rows;
}

/** The stored form of a public address (English without its prefix, as the API stores it). */
const stored = (pub: string) => (pub === "/en" ? "/" : pub.startsWith("/en/") ? pub.slice(3) : pub);

/**
 * The resolve API of an environment where every target is published: live content first, then
 * the redirect row of the address (old addresses are looked up in lower case, DP-212).
 */
function site(rows: Map<string, string>, live: Set<string>, locales: string[]) {
  const loops: string[][] = [];
  const deps: ProxyDeps = {
    resolve: async (
      path: string,
      _search: string,
      locale?: RouteLocale,
    ): Promise<ResolveAnswer> => {
      const address = locale ? (path === "/" ? `/${locale}` : `/${locale}${path}`) : path;
      if (live.has(address)) return { status: "found" };
      const target = rows.get(address.toLowerCase());
      return target ? { status: "redirect", target, statusCode: 301 } : { status: "not_found" };
    },
    publicLocales: async () => locales,
    privacyPublished: true,
    privacyLocales: ["en"],
    onLoop: (t) => loops.push([...t]),
  };
  return { deps, loops };
}

const get = (deps: ProxyDeps, address: string) => {
  const q = address.indexOf("?");
  return q === -1
    ? decideRequest(address, "", "GET", deps)
    : decideRequest(address.slice(0, q), address.slice(q), "GET", deps);
};

const now = rowsOf(CORPORATE_REDIRECTS_CSV);
const liveNow = new Set(CORPORATE_LEGACY_INVENTORY.map((r) => stored(r.now)));

describe("old corporate addresses today (Turkish not public)", () => {
  const { deps, loops } = site(now, liveNow, ["en"]);

  it("keeps the new site's own addresses", async () => {
    const keep = CORPORATE_LEGACY_INVENTORY.filter((r) => r.decision === "KEEP");
    assert.equal(keep.length, 9);
    for (const r of keep) assert.deepEqual(await get(deps, r.source), { action: "next" }, r.source);
  });

  it("answers every other old address with ONE 301 to its own content", async () => {
    const moved = CORPORATE_LEGACY_INVENTORY.filter((r) => r.decision !== "KEEP");
    assert.equal(moved.length, 175);
    for (const r of moved) {
      const variants = [r.source];
      if (r.source !== "/") variants.push(`${r.source}/`);
      // Old addresses are looked up in lower case (DP-212); the site's own forms are not.
      if (r.decision === "ROW") variants.push(r.source.toUpperCase());
      for (const v of variants) {
        const answer = await get(deps, v);
        assert.deepEqual(answer, { action: "redirect", location: r.now, status: 301 }, v);
        // The target is final: asking it again renders it (no second hop).
        assert.deepEqual(await get(deps, r.now), { action: "next" }, r.now);
      }
    }
    assert.deepEqual(loops, []);
  });

  it("keeps the query of an old address (`/blogs?page=2`, the contact form's message)", async () => {
    assert.deepEqual(await get(deps, "/blogs?page=2"), {
      action: "redirect",
      location: "/en/news?page=2",
      status: 301,
    });
    assert.deepEqual(await get(deps, "/ru/contact-us?message=COA"), {
      action: "redirect",
      location: "/en/contact?message=COA",
      status: 301,
    });
  });

  it("leaves Turkish addresses a 404 while Turkish is not public (old /tr/iletisim too)", async () => {
    for (const p of ["/tr", "/tr/contact", "/tr/iletisim", "/tr/news"]) {
      assert.deepEqual(await get(deps, p), { action: "not-found", locale: "tr" }, p);
    }
  });

  it("answers an address the old site never had with the 404, not the home page", async () => {
    for (const p of ["/ru/no-such-page", "/blogs/999/x", "/en/blogs/999/x"]) {
      const answer = await get(deps, p);
      assert.equal(answer.action, "not-found", p);
    }
  });
});

describe("old corporate addresses once Turkish is public (transition file imported)", () => {
  const rows = new Map([...now, ...rowsOf(CORPORATE_TR_PUBLIC_CSV)]);
  const live = new Set([...liveNow, ...CORPORATE_LEGACY_INVENTORY.map((r) => stored(r.trPublic))]);
  const { deps, loops } = site(rows, live, ["en", "tr"]);

  it("sends the old Turkish posts to their Turkish page, the other languages unchanged", async () => {
    for (const r of CORPORATE_LEGACY_INVENTORY.filter((x) => x.decision === "ROW")) {
      const answer = await get(deps, r.source);
      assert.deepEqual(answer, { action: "redirect", location: r.trPublic, status: 301 }, r.source);
      assert.deepEqual(await get(deps, r.trPublic), { action: "next" }, r.trPublic);
    }
    assert.deepEqual(await get(deps, "/tr/iletisim"), {
      action: "redirect",
      location: "/tr/contact",
      status: 301,
    });
    assert.deepEqual(await get(deps, "/tr/contact"), { action: "next" });
    assert.deepEqual(loops, []);
  });

  it("keeps the COM-1 site rule for unprefixed addresses (the default language) until the owner decides", async () => {
    for (const r of CORPORATE_LEGACY_INVENTORY.filter((x) => x.decision === "SITE_RULE")) {
      assert.deepEqual(
        await get(deps, r.source),
        { action: "redirect", location: r.now, status: 301 },
        r.source,
      );
    }
  });
});
