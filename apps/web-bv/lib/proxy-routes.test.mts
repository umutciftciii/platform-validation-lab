// DP-220: the proxy's address forms. The lead form of a lead-gated document is one of the site's own
// addresses (not an old-site address, which was always a 404 since DP-212), and only for a document
// the product lists as requestable.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPath, documentRequestStatus, type DocumentsRead } from "./proxy-routes.ts";

const DOC = "01a1eb64-aeb0-7112-93ac-1a6ee105cdc7";
const OTHER = "0190f2a1-0000-7000-8000-000000000000";

describe("classifyPath", () => {
  it("recognises the document request form", () => {
    assert.deepEqual(classifyPath(`/products/iccsyn-10-ctl-technology/documents/${DOC}`), {
      kind: "document-request",
      slug: "iccsyn-10-ctl-technology",
      id: DOC,
    });
  });

  it("answers a malformed document request address with a 404, never an old-site lookup", () => {
    for (const p of [
      `/products/iccsyn-10-ctl-technology/documents/not-an-id`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC.toUpperCase()}`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC}x`,
      `/products/ICCSYN-10/documents/${DOC}`,
      `/products/bad--slug/documents/${DOC}`,
      `/products/${"a".repeat(121)}/documents/${DOC}`,
      `/products/iccsyn-10-ctl-technology/documents/`,
    ]) {
      assert.deepEqual(classifyPath(p), { kind: "not-found" }, p);
    }
  });

  it("does not open other /products sub-paths", () => {
    // Deeper or other sub-paths are no address of this site: an old-site lookup (redirect only,
    // otherwise 404) as before, never a page.
    for (const p of [
      `/products/iccsyn-10-ctl-technology/documents`,
      `/products/iccsyn-10-ctl-technology/specs`,
      `/products/iccsyn-10-ctl-technology/files/${DOC}`,
      `/products/iccsyn-10-ctl-technology/documents/${DOC}/download`,
      `/products/a/b`,
    ]) {
      const route = classifyPath(p);
      assert.ok(route.kind === "legacy" || route.kind === "not-found", `${p}: ${route.kind}`);
    }
  });

  it("keeps the DP-207/DP-212 forms unchanged", () => {
    const cases: [string, string][] = [
      ["/about-us", "content"],
      ["/news/some-article", "content"],
      ["/products/iccsyn-10-ctl-technology", "content"],
      ["/products", "next"],
      ["/news", "next"],
      ["/privacy", "privacy"],
      ["/favicon.ico", "next"],
      ["/robots.txt", "next"],
      ["/sitemap.xml", "next"],
      ["/index.html", "legacy"],
      // one lower-case segment is asked as a CMS page; the resolve API answers its import redirect
      ["/en", "content"],
      ["/en/products/base-oil", "legacy"],
      ["/tr/hakkimizda", "legacy"],
      ["/About-Us", "legacy"],
      ["/news/a/b", "legacy"],
      ["/a/b/c/d/e/f/g", "not-found"],
      ["/x%2e%2e/y", "not-found"],
    ];
    for (const [p, kind] of cases) assert.equal(classifyPath(p).kind, kind, p);
  });
});

describe("documentRequestStatus", () => {
  const listed = (requestable: boolean, id = DOC): DocumentsRead => ({
    ok: true,
    data: [{ id, requestable }],
  });

  it("renders the form for a requestable document", () => {
    assert.equal(documentRequestStatus(listed(true), DOC), "page");
  });

  it("is a 404 for an unknown document or one without a form", () => {
    assert.equal(documentRequestStatus(listed(true, OTHER), DOC), "not_found");
    assert.equal(documentRequestStatus(listed(false), DOC), "not_found");
    assert.equal(documentRequestStatus({ ok: true, data: [] }, DOC), "not_found");
  });

  it("is a 404 for an unknown or unpublished product", () => {
    assert.equal(documentRequestStatus({ ok: false, reason: "not_found" }, DOC), "not_found");
  });

  it("fails open while the API cannot answer (the page does its own checks)", () => {
    assert.equal(documentRequestStatus({ ok: false, reason: "unavailable" }, DOC), "page");
  });
});
