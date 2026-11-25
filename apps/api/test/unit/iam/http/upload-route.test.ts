// PM-2: only the admin image-upload route takes a non-JSON body; everything else keeps the
// 16 KB JSON rule.
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_TYPES,
  IMAGE_UPLOAD_MAX_BYTES,
  isDocumentUpload,
  isImageUpload,
  jsonBodyLimit,
  MAX_BODY_BYTES,
  rawUpload,
} from "../../../../src/iam/http/security.middleware.js";

describe("image upload route", () => {
  const p = "/api/v1/admin/catalog/products/0190f2a1-0000-7000-8000-000000000000/images";
  it("matches only PUT from the admin app on the exact path", () => {
    expect(isImageUpload("ADMIN", "PUT", p)).toBe(true);
    expect(isImageUpload("ADMIN", "POST", p)).toBe(false);
    expect(isImageUpload("WEB_BV", "PUT", p)).toBe(false);
    expect(isImageUpload("ADMIN", "PUT", `${p}/order`)).toBe(false);
    expect(isImageUpload("ADMIN", "PUT", "/api/v1/admin/catalog/products/x/y/images")).toBe(false);
    expect(isImageUpload("ADMIN", "PUT", "/api/v1/auth/staff/login")).toBe(false);
  });
  it("keeps the JSON limit and caps uploads at 10 MB", () => {
    expect(MAX_BODY_BYTES).toBe(16 * 1024);
    expect(IMAGE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

// PM-5: the second raw-body route, the document revision upload (PDF, 20 MB).
describe("document upload route", () => {
  const p = "/api/v1/admin/catalog/documents/0190f2a1-0000-7000-8000-000000000000/revisions";
  it("matches only PUT from the admin app on the exact path", () => {
    expect(isDocumentUpload("ADMIN", "PUT", p)).toBe(true);
    expect(isDocumentUpload("ADMIN", "POST", p)).toBe(false);
    expect(isDocumentUpload("WEB_BV", "PUT", p)).toBe(false);
    expect(isDocumentUpload("WEB_CORPORATE", "PUT", p)).toBe(false);
    expect(isDocumentUpload("ADMIN", "PUT", `${p}/x`)).toBe(false);
    expect(isDocumentUpload("ADMIN", "PUT", "/api/v1/admin/catalog/documents/a/b/revisions")).toBe(
      false,
    );
  });
  it("gives each upload route its own types and limit", () => {
    expect(rawUpload("ADMIN", "PUT", p)).toEqual({
      types: DOCUMENT_UPLOAD_TYPES,
      maxBytes: 20 * 1024 * 1024,
    });
    expect([...DOCUMENT_UPLOAD_TYPES]).toEqual(["application/pdf"]);
    expect(DOCUMENT_UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
    const img = "/api/v1/admin/catalog/products/0190f2a1-0000-7000-8000-000000000000/images";
    expect(rawUpload("ADMIN", "PUT", img)?.types.has("application/pdf")).toBe(false);
    expect(rawUpload("ADMIN", "POST", p)).toBeNull();
  });
});

// DP-212: the one JSON route with a larger limit (the redirect CSV import of the admin app).
describe("redirect import body limit", () => {
  const p = "/api/v1/admin/seo/sites/0190f2a1-0000-7000-8000-000000000000/redirects/import";
  it("is 320 KB only for POST from the admin app on the exact path", () => {
    expect(jsonBodyLimit("ADMIN", "POST", p)).toBe(320 * 1024);
    expect(jsonBodyLimit("WEB_BV", "POST", p)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "PUT", p)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "POST", `${p}/x`)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "POST", p.replace("/import", ""))).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "POST", "/api/v1/auth/staff/login")).toBe(MAX_BODY_BYTES);
  });
});

describe("translation package routes (ML-13a, DP-244)", () => {
  const p = "/api/v1/admin/translation-packages";
  it("is 4 MB only for POST dry-run and import from the admin app", () => {
    expect(jsonBodyLimit("ADMIN", "POST", `${p}/import`)).toBe(4 * 1024 * 1024);
    expect(jsonBodyLimit("ADMIN", "POST", `${p}/dry-run`)).toBe(4 * 1024 * 1024);
    expect(jsonBodyLimit("WEB_BV", "POST", `${p}/import`)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "PUT", `${p}/import`)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "POST", `${p}/export`)).toBe(MAX_BODY_BYTES);
    expect(jsonBodyLimit("ADMIN", "POST", `${p}/import/x`)).toBe(MAX_BODY_BYTES);
  });
});
