// COM-1: the corporate proxy's address forms and decision: language prefix, real 404s, redirects
// of Admin > SEO > Redirects in one hop, cycles refused, the trailing slash.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  MAX_HOPS,
  TECHNICAL_PREFIXES,
  classifyPath,
  decide,
  decideRequest,
  type ProxyDeps,
  type ResolveAnswer,
} from "./proxy-routes.ts";
import type { RouteLocale } from "./locale-routing.ts";

type Table = Record<string, ResolveAnswer>;

function fakeDeps(table: Table = {}, opts: Partial<ProxyDeps> = {}) {
  const calls: string[] = [];
  const loops: string[][] = [];
  const deps: ProxyDeps = {
    // The table is keyed by language and stored path; the query is passed through (DP-211).
    resolve: async (path: string, _search: string, locale?: RouteLocale) => {
      const key = `${locale ?? "-"} ${path}`;
      calls.push(key);
      return table[key] ?? { status: "not_found" };
    },
    publicLocales: async () => ["en"],
    privacyPublished: true,
    privacyLocales: ["en"],
    onLoop: (t) => loops.push([...t]),
    ...opts,
  };
  return { deps, calls, loops };
}

const found: ResolveAnswer = { status: "found" };
const to = (target: string, statusCode: 301 | 302 = 301): ResolveAnswer => ({
  status: "redirect",
  target,
  statusCode,
});

describe("classifyPath", () => {
  it("tells the corporate forms apart", () => {
    assert.deepEqual(classifyPath("/"), { kind: "root" });
    assert.deepEqual(classifyPath("/en"), { kind: "home", locale: "en" });
    assert.deepEqual(classifyPath("/tr"), { kind: "home", locale: "tr" });
    assert.deepEqual(classifyPath("/tr/privacy"), { kind: "privacy", locale: "tr" });
    assert.deepEqual(classifyPath("/en/about-us"), {
      kind: "content",
      locale: "en",
      rest: "/about-us",
    });
    assert.deepEqual(classifyPath("/about-us"), { kind: "unprefixed", rest: "/about-us" });
    assert.deepEqual(classifyPath("/privacy"), { kind: "unprefixed", rest: "/privacy" });
    for (const p of [
      "/_next/static/x.js",
      "/api/health",
      "/media/a.png",
      // COM-2a (DP-321): signed previews are never decided by the proxy.
      "/preview/v1.token",
      "/favicon.ico",
      "/robots.txt",
    ]) {
      assert.equal(classifyPath(p).kind, "next", p);
    }
  });

  it("sends other addresses to the old-address lookup or the 404", () => {
    // The old site's languages that the new site does not have (RU, ZH, ES, DE): COM-6 maps them.
    assert.equal(classifyPath("/ru/about-us").kind, "legacy");
    assert.equal(classifyPath("/en/blogs/some-post").kind, "legacy");
    assert.equal(classifyPath("/index.html").kind, "legacy");
    // The catalogue routes are BV's; a product address is no content page here.
    assert.notEqual(classifyPath("/en/products/x").kind, "content");
    // COM-3: only the exact news forms are the site's own.
    assert.equal(classifyPath("/en/news/Some-Post").kind, "legacy");
    assert.equal(classifyPath("/en/news/a/b").kind, "legacy");
  });

  it("tells the news list and articles apart (COM-3)", () => {
    assert.deepEqual(classifyPath("/en/news"), { kind: "content", locale: "en", rest: "/news" });
    assert.deepEqual(classifyPath("/tr/news/some-post"), {
      kind: "content",
      locale: "tr",
      rest: "/news/some-post",
    });
    assert.deepEqual(classifyPath("/news/some-post"), {
      kind: "unprefixed",
      rest: "/news/some-post",
    });
  });
});

describe("decide", () => {
  it("answers / and unprefixed addresses with one 301 into English (query kept)", async () => {
    const { deps } = fakeDeps({ "- /about-us": found });
    assert.deepEqual(await decide("/", "?utm=1", deps), {
      action: "redirect",
      location: "/en?utm=1",
      status: 301,
    });
    assert.deepEqual(await decide("/about-us", "", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
  });

  it("renders live content and answers a real 404 otherwise", async () => {
    const { deps, calls } = fakeDeps({ "- /about-us": found });
    assert.deepEqual(await decide("/en/about-us", "", deps), { action: "next" });
    assert.deepEqual(calls, ["- /about-us"]);
    assert.deepEqual(await decide("/en/unknown", "", deps), { action: "not-found", locale: "en" });
  });

  it("keeps Turkish a 404 until it is public, then resolves inside the language", async () => {
    const closed = fakeDeps({ "tr /hakkimizda": found });
    assert.deepEqual(await decide("/tr", "", closed.deps), { action: "not-found", locale: "tr" });
    assert.deepEqual(await decide("/tr/hakkimizda", "", closed.deps), {
      action: "not-found",
      locale: "tr",
    });
    assert.deepEqual(closed.calls, [], "nothing of a hidden language is asked");
    const open = fakeDeps(
      { "tr /": found, "tr /hakkimizda": found },
      { publicLocales: async () => ["en", "tr"] },
    );
    assert.deepEqual(await decide("/tr", "", open.deps), { action: "next" });
    assert.deepEqual(await decide("/tr/hakkimizda", "", open.deps), { action: "next" });
    assert.deepEqual(open.calls, ["tr /", "tr /hakkimizda"]);
  });

  it("renders the news list and articles only where they are live (COM-3)", async () => {
    const { deps, calls } = fakeDeps({
      "- /news": found,
      "- /news/market-note": found,
      "- /news/withdrawn": { status: "unpublished" },
    });
    assert.deepEqual(await decide("/en/news", "", deps), { action: "next" });
    // The list's pages keep their query (the page decides whether the page exists).
    assert.deepEqual(await decide("/en/news", "?page=2", deps), { action: "next" });
    assert.deepEqual(await decide("/en/news/market-note", "", deps), { action: "next" });
    // An article taken off the site renders its "no longer available" page; unknown is a 404.
    assert.deepEqual(await decide("/en/news/withdrawn", "", deps), { action: "next" });
    assert.deepEqual(await decide("/en/news/unknown", "", deps), {
      action: "not-found",
      locale: "en",
    });
    assert.ok(calls.includes("- /news/market-note"));
    // A page taken off the site stays a 404 (only articles have the withdrawn page).
    const page = fakeDeps({ "- /about-us": { status: "unpublished" } });
    assert.deepEqual(await decide("/en/about-us", "", page.deps), {
      action: "not-found",
      locale: "en",
    });
    // No published heading: the list is the site's 404.
    assert.deepEqual(await decide("/en/news", "", fakeDeps({}).deps), {
      action: "not-found",
      locale: "en",
    });
    // Unprefixed: one 301 into English.
    assert.deepEqual(await decide("/news/market-note", "", deps), {
      action: "redirect",
      location: "/en/news/market-note",
      status: 301,
    });
    // Turkish inside its language once public.
    const tr = fakeDeps(
      { "tr /news": found, "tr /news/piyasa-notu": found },
      { publicLocales: async () => ["en", "tr"] },
    );
    assert.deepEqual(await decide("/tr/news/piyasa-notu", "", tr.deps), { action: "next" });
    assert.deepEqual(tr.calls, ["tr /news/piyasa-notu"]);
  });

  it("renders the home page only where it is published (COM-2b)", async () => {
    const live = fakeDeps({ "- /": found });
    assert.deepEqual(await decide("/en", "", live.deps), { action: "next" });
    assert.deepEqual(live.calls, ["- /"]);
    // Not published (an environment without imported content): the site's 404, in English.
    const none = fakeDeps({});
    assert.deepEqual(await decide("/en", "", none.deps), { action: "not-found", locale: "en" });
    // The API cannot answer: the page renders and does its own checks.
    const down = fakeDeps({ "- /": { status: "unknown" } });
    assert.deepEqual(await decide("/en", "", down.deps), { action: "next" });
    // A Turkish home page that is public but not published is a 404 too.
    const trEmpty = fakeDeps({}, { publicLocales: async () => ["en", "tr"] });
    assert.deepEqual(await decide("/tr", "", trEmpty.deps), { action: "not-found", locale: "tr" });
  });

  it("fails closed on the language list and open on the content check", async () => {
    const unknownLocales = fakeDeps({}, { publicLocales: async () => null });
    assert.deepEqual(await decide("/tr", "", unknownLocales.deps), {
      action: "not-found",
      locale: "tr",
    });
    const apiDown = fakeDeps({ "- /about-us": { status: "unknown" } });
    assert.deepEqual(await decide("/en/about-us", "", apiDown.deps), { action: "next" });
  });

  it("answers a stored redirect at its public address in one hop", async () => {
    const { deps } = fakeDeps({
      "- /old-page": to("/about-us"),
      "- /about-us": found,
    });
    assert.deepEqual(await decide("/en/old-page", "?ref=x", deps), {
      action: "redirect",
      location: "/en/about-us?ref=x",
      status: 301,
    });
    // An unprefixed old address: 301 into English, then its row — still one hop.
    assert.deepEqual(await decide("/old-page", "", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
  });

  it("keeps a temporary redirect temporary and allows external targets", async () => {
    const { deps } = fakeDeps({
      "- /campaign": to("/about-us", 302),
      "- /about-us": found,
      "- /group": to("https://dreampetroleumbv.com/en"),
    });
    assert.deepEqual(await decide("/en/campaign", "", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 302,
    });
    assert.deepEqual(await decide("/en/group", "", deps), {
      action: "redirect",
      location: "https://dreampetroleumbv.com/en",
      status: 301,
    });
  });

  it("answers an old-site address only with its row", async () => {
    const { deps } = fakeDeps({ "- /ru/about-us": to("/about-us"), "- /about-us": found });
    assert.deepEqual(await decide("/ru/about-us", "", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
    assert.deepEqual(await decide("/ru/other", "", deps), { action: "not-found", locale: "en" });
  });

  it("refuses a cycle back to the request and an over-long chain", async () => {
    const cycle = fakeDeps({ "- /a": to("/b"), "- /b": to("/a") });
    assert.deepEqual(await decide("/en/a", "", cycle.deps), { action: "not-found", locale: "en" });
    assert.equal(cycle.loops.length, 1);
    const table: Table = {};
    for (let i = 0; i <= MAX_HOPS + 1; i++) table[`- /p${i}`] = to(`/p${i + 1}`);
    const chain = fakeDeps(table);
    assert.deepEqual(await decide("/en/p0", "", chain.deps), { action: "not-found", locale: "en" });
  });

  it("opens the privacy policy only where it is published in that language", async () => {
    const { deps } = fakeDeps({}, { publicLocales: async () => ["en", "tr"] });
    assert.deepEqual(await decide("/en/privacy", "", deps), { action: "next" });
    assert.deepEqual(await decide("/tr/privacy", "", deps), { action: "not-found", locale: "tr" });
    const hidden = fakeDeps({}, { privacyPublished: false });
    assert.deepEqual(await decide("/en/privacy", "", hidden.deps), {
      action: "not-found",
      locale: "en",
    });
  });
});

describe("decideRequest", () => {
  it("normalises a trailing slash (308) unless the bare address redirects itself", async () => {
    const { deps } = fakeDeps({ "- /about-us": found });
    assert.deepEqual(await decideRequest("/en/about-us/", "", "GET", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 308,
    });
    assert.deepEqual(await decideRequest("/about-us/", "", "GET", deps), {
      action: "redirect",
      location: "/en/about-us",
      status: 301,
    });
    assert.deepEqual(await decideRequest("/en/about-us", "", "POST", deps), { action: "next" });
  });

  it("TECHNICAL_PREFIXES are exactly the prefixes the proxy.ts matcher leaves out", () => {
    const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    const m = /\(\?!([^)]+)\)/.exec(src);
    assert.ok(m, "matcher exclusion not found");
    const fromMatcher = (m[1] as string).split("|").map((p) => `/${p}`);
    assert.deepEqual([...fromMatcher].sort(), [...TECHNICAL_PREFIXES].sort());
    assert.ok(src.includes('"/:path+/"'), "matcher for addresses with a trailing slash");
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    assert.match(config, /skipTrailingSlashRedirect: true/);
    assert.match(config, /globalNotFound: true/);
  });
});
