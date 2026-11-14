// PM-5 (DP-035, ADR-014): fail-closed access decisions, the effective site state of a document,
// and the stamper registry that DP-043 extends with the watermark.
import { describe, expect, it } from "vitest";
import {
  decideDocumentAccess,
  DOCUMENT_ACCESS_CAPABILITIES,
  DocumentStampers,
  IDENTITY_STAMPER,
  offeredToVisitors,
  StamperMissing,
  type DeliveryContext,
} from "../../../src/catalog/document-delivery.js";
import { documentDisposition, siteState } from "../../../src/catalog/documents.service.js";

const ctx: DeliveryContext = {
  documentId: "d",
  revisionId: "r",
  revisionNumber: 1,
  siteId: "s",
  policy: "PUBLIC",
  requestId: "req-12345678",
  deliveredAt: new Date(),
};

describe("decideDocumentAccess", () => {
  it("ships with lead grants on (DP-042, DP-043) and membership off (DP-039)", () => {
    expect(DOCUMENT_ACCESS_CAPABILITIES).toEqual({ memberAccounts: false, leadGrants: true });
  });
  it("opens PUBLIC freely and LEAD_REQUIRED with a grant; MEMBERS_ONLY stays closed", () => {
    expect(decideDocumentAccess("PUBLIC")).toEqual({ downloadable: true, requires: "nothing" });
    expect(decideDocumentAccess("MEMBERS_ONLY")).toEqual({
      downloadable: false,
      reason: "awaiting_membership",
    });
    expect(decideDocumentAccess("LEAD_REQUIRED")).toEqual({
      downloadable: true,
      requires: "lead_grant",
    });
    expect(
      decideDocumentAccess("LEAD_REQUIRED", { memberAccounts: false, leadGrants: false }),
    ).toEqual({ downloadable: false, reason: "awaiting_lead_capture" });
    expect(decideDocumentAccess("INTERNAL")).toEqual({ downloadable: false, reason: "internal" });
  });
  it("still demands per-request proof once a capability exists", () => {
    const on = { memberAccounts: true, leadGrants: true };
    expect(decideDocumentAccess("MEMBERS_ONLY", on)).toEqual({
      downloadable: true,
      requires: "member_session",
    });
    expect(decideDocumentAccess("LEAD_REQUIRED", on)).toEqual({
      downloadable: true,
      requires: "lead_grant",
    });
    expect(decideDocumentAccess("INTERNAL", on)).toEqual({
      downloadable: false,
      reason: "internal",
    });
  });
  it("refuses an unknown policy", () => {
    expect(decideDocumentAccess("SECRET" as never).downloadable).toBe(false);
  });
});

describe("siteState", () => {
  const base = {
    status: "ACTIVE" as const,
    accessPolicy: "PUBLIC" as const,
    hasActiveRevision: true,
    enabled: true,
    productLive: true,
  };
  it("is served only when every rule holds", () => {
    expect(siteState(base)).toBe("served");
    expect(siteState({ ...base, status: "ARCHIVED" })).toBe("archived");
    expect(siteState({ ...base, accessPolicy: "INTERNAL" })).toBe("internal");
    expect(siteState({ ...base, hasActiveRevision: false })).toBe("no_file");
    expect(siteState({ ...base, enabled: false })).toBe("hidden");
    expect(siteState({ ...base, productLive: false })).toBe("product_not_live");
    expect(siteState({ ...base, accessPolicy: "MEMBERS_ONLY" })).toBe("awaiting_membership");
    expect(siteState({ ...base, accessPolicy: "LEAD_REQUIRED" })).toBe("served_on_request");
  });
});

describe("DocumentStampers", () => {
  it("delivers PUBLIC files unchanged", async () => {
    const s = new DocumentStampers();
    const pdf = Buffer.from("%PDF-1.7 x");
    expect(s.for("PUBLIC")).toBe(IDENTITY_STAMPER);
    expect(await s.for("PUBLIC").stamp(pdf, ctx)).toBe(pdf);
  });
  it("has no stamper for gated or internal policies until one is registered", () => {
    const s = new DocumentStampers();
    expect(() => s.for("MEMBERS_ONLY")).toThrow(StamperMissing);
    expect(() => s.for("LEAD_REQUIRED")).toThrow(StamperMissing);
    expect(() => s.for("INTERNAL")).toThrow(StamperMissing);
  });
  it("lets DP-043 register a watermark stamper, never for PUBLIC", async () => {
    const s = new DocumentStampers();
    const mark = {
      name: "test-watermark",
      stamp: (pdf: Buffer) => Promise.resolve(Buffer.concat([pdf, Buffer.from("%mark")])),
    };
    s.register("LEAD_REQUIRED", mark);
    expect((await s.for("LEAD_REQUIRED").stamp(Buffer.from("%PDF"), ctx)).toString()).toBe(
      "%PDF%mark",
    );
    expect(() => s.register("PUBLIC", mark)).toThrow();
  });
});

describe("documentDisposition", () => {
  it("encodes the name for both header forms", () => {
    expect(documentDisposition("attachment", 'TDS "ICCSYN" 6 – EN.pdf')).toBe(
      `attachment; filename="TDS _ICCSYN_ 6 _ EN.pdf"; filename*=UTF-8''TDS%20%22ICCSYN%22%206%20%E2%80%93%20EN.pdf`,
    );
    expect(documentDisposition("inline", "a.pdf")).toMatch(/^inline; /);
  });
});

describe("offeredToVisitors (DP-163 list indicator)", () => {
  it("counts PUBLIC and LEAD_REQUIRED only; MEMBERS_ONLY and INTERNAL never", () => {
    expect(offeredToVisitors("PUBLIC")).toBe(true);
    expect(offeredToVisitors("LEAD_REQUIRED")).toBe(true);
    expect(offeredToVisitors("MEMBERS_ONLY")).toBe(false);
    expect(offeredToVisitors("INTERNAL")).toBe(false);
  });
  it("follows the capability switches (fail-closed)", () => {
    const off = { memberAccounts: false, leadGrants: false };
    expect(offeredToVisitors("LEAD_REQUIRED", off)).toBe(false);
    // member sessions open MEMBERS_ONLY downloads, but not to an anonymous visitor of the list
    expect(offeredToVisitors("MEMBERS_ONLY", { memberAccounts: true, leadGrants: true })).toBe(
      false,
    );
  });
});
