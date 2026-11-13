// DP-042/DP-043 (ADR-016): the lead form contract, consent evidence and the watermark stamper.
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEAD_TEXT_ARCHIVE,
  LeadDocumentRequestInputSchema,
  isFreeMailDomain,
  privacyBlockers,
} from "@dream/contracts";
import type { ApiConfig } from "../../../src/iam/http/api-config.js";
import { LeadRequestsService } from "../../../src/leads/lead-requests.service.js";
import {
  MARKETING_CONSENT_SHA256,
  PRIVACY_NOTICE_SHA256,
  consentVersionProblem,
  newRequestReference,
  textSha256,
} from "../../../src/leads/consent.js";
import {
  LEAD_WATERMARK_STAMPER,
  encodableText,
  fitLine,
  watermarkLine,
} from "../../../src/catalog/watermark.js";
import type { DeliveryContext } from "../../../src/catalog/document-delivery.js";
import { makePdf } from "../../fixtures/pdf.js";

const DOC = "0190f3a0-0000-7000-8000-000000000001";
const valid = {
  documentId: DOC,
  fullName: "Ada Lovelace",
  company: "Analytical Engines Ltd",
  email: "Ada@Engines.Example",
  country: "NL",
  privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
  privacyNoticeAccepted: true,
  marketingConsent: false,
  marketingConsentVersion: null,
  website: "",
};

describe("LeadDocumentRequestInputSchema", () => {
  it("normalises a valid form", () => {
    const r = LeadDocumentRequestInputSchema.parse({ ...valid, fullName: "  Ada \n  Lovelace " });
    expect(r.email).toBe("ada@engines.example");
    expect(r.fullName).toBe("Ada Lovelace");
  });
  it.each([
    ["privacy notice not confirmed", { privacyNoticeAccepted: false }],
    ["honeypot filled", { website: "x" }],
    ["unknown country", { country: "XX" }],
    ["lower-case country", { country: "nl" }],
    ["markup in the name", { fullName: "<b>Ada</b>" }],
    ["control character", { company: "ACME\u0007" }],
    ["one-letter name", { fullName: "A" }],
    ["unknown key", { phone: "123" }],
    ["not an e-mail", { email: "ada" }],
  ])("refuses %s", (_label, change) => {
    expect(LeadDocumentRequestInputSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it("knows exactly the 249 ISO 3166-1 alpha-2 codes, sorted and unique", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
  });
  it("flags free-mail domains", () => {
    expect(isFreeMailDomain("x@gmail.com")).toBe(true);
    expect(isFreeMailDomain("x@GMAIL.COM")).toBe(true);
    expect(isFreeMailDomain("x@shell.com")).toBe(false);
  });
});

describe("consent evidence", () => {
  it("hashes the exact current texts", () => {
    expect(PRIVACY_NOTICE_SHA256).toBe(textSha256(LEAD_PRIVACY_NOTICE.text));
    expect(MARKETING_CONSENT_SHA256).toBe(textSha256(LEAD_MARKETING_CONSENT.text));
    expect(PRIVACY_NOTICE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses outdated versions, and the marketing version only when consent is given", () => {
    const ok = {
      privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
      marketingConsent: false,
      marketingConsentVersion: null,
    };
    expect(consentVersionProblem(ok)).toBeNull();
    expect(consentVersionProblem({ ...ok, privacyNoticeVersion: "2020-01-01" })).toBe(
      "privacyNoticeVersion",
    );
    expect(consentVersionProblem({ ...ok, marketingConsent: true })).toBe(
      "marketingConsentVersion",
    );
    expect(
      consentVersionProblem({
        ...ok,
        marketingConsent: true,
        marketingConsentVersion: LEAD_MARKETING_CONSENT.version,
      }),
    ).toBeNull();
  });
  it("makes 8-character Crockford references", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const r = newRequestReference();
      expect(r).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      seen.add(r);
    }
    expect(seen.size).toBeGreaterThan(495);
  });
});

const ctx = (label: string): DeliveryContext => ({
  documentId: DOC,
  revisionId: "0190f3a0-0000-7000-8000-000000000002",
  revisionNumber: 3,
  siteId: "0190f3a0-0000-7000-8000-000000000003",
  policy: "LEAD_REQUIRED",
  grant: { id: "g", reference: "AB12CD34", recipientLabel: label, issuedAt: new Date() },
  requestId: "req-12345678",
  deliveredAt: new Date("2026-11-11T10:00:00Z"),
});

describe("watermark", () => {
  it("names the recipient, the UTC date, the reference and the publisher", () => {
    expect(watermarkLine(ctx("Ada Lovelace (Engines)"))).toBe(
      "Prepared for Ada Lovelace (Engines) · 2026-11-11 UTC · Ref AB12CD34 · Dream Petroleum BV",
    );
  });
  it("refuses to stamp without a grant", async () => {
    const noGrant = ctx("x");
    delete noGrant.grant;
    await expect(LEAD_WATERMARK_STAMPER.stamp(makePdf(), noGrant)).rejects.toThrow(/grant/);
  });
  it("keeps WinAnsi letters, strips other diacritics and replaces the rest", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(encodableText("Müller Ştefan Łukasz ıİ ß 李", font)).toBe("Müller Stefan Lukasz iI ß ?");
  });
  it("shrinks the type, then shortens only the recipient", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const rest = " · 2026-11-11 UTC · Ref AB12CD34 · Dream Petroleum BV";
    const short = fitLine("Ada", rest, font, 500);
    expect(short).toEqual({ text: `Prepared for Ada${rest}`, size: 7 });
    const long = fitLine("A".repeat(300), rest, font, 300);
    expect(long.size).toBe(4.5);
    expect(long.text.endsWith(`…${rest}`)).toBe(true);
    expect(font.widthOfTextAtSize(long.text, long.size)).toBeLessThanOrEqual(300);
  });
  it("stamps every page, also rotated ones, and leaves the input untouched", async () => {
    const src = await PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) src.addPage([595, 842]).setRotation(degrees(angle));
    const input = Buffer.from(await src.save());
    const copy = Buffer.from(input);
    const out = await LEAD_WATERMARK_STAMPER.stamp(input, ctx("Grace Hopper (Navy)"));
    expect(input.equals(copy)).toBe(true);
    // updateMetadata: false, or loading would overwrite the producer itself.
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getKeywords()).toBe("ref:AB12CD34 revision:3");
    expect(doc.getSubject()).toBe("Prepared for Grace Hopper (Navy)");
    expect(doc.getProducer()).toBe("Dream Petroleum BV");
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 180, 270]);
  });
  it("stamps the test fixture PDFs (xref table and object stream)", async () => {
    for (const pdf of [makePdf({ pages: 3 }), makePdf({ objectStream: ["<< /Foo 1 >>"] })]) {
      const out = await LEAD_WATERMARK_STAMPER.stamp(pdf, ctx("Ada (Engines)"));
      expect(out.subarray(0, 5).toString()).toBe("%PDF-");
      await expect(PDFDocument.load(out)).resolves.toBeTruthy();
    }
  });
});

describe("DP-095 production gate of the lead form (D-T3, D-T5)", () => {
  // Stubs that fail the test if the service gets past the gate.
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error("the gate must refuse before anything else runs");
      },
    },
  );
  const service = (deployEnv: "local" | "staging" | "production") =>
    new LeadRequestsService(
      untouched as never,
      untouched as never,
      untouched as never,
      { deployEnv } as ApiConfig,
    );

  it("refuses the form like an unknown document in production while the texts are drafts", async () => {
    expect(privacyBlockers().length).toBeGreaterThan(0);
    await expect(service("production").request({} as never, valid)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets the form through outside production (drafts are visible there)", async () => {
    // Past the gate the stubs throw: proof the gate itself did not refuse.
    await expect(service("staging").request({} as never, valid)).rejects.toThrow(
      /gate must refuse/,
    );
  });

  it("archives the previous texts so older evidence stays checkable (D-T7)", () => {
    const old = LEAD_TEXT_ARCHIVE.privacyNotice.find((t) => t.version === "2026-11-11");
    expect(old).toBeDefined();
    expect(textSha256(old!.text)).toMatch(/^[0-9a-f]{64}$/);
    expect(textSha256(old!.text)).not.toBe(PRIVACY_NOTICE_SHA256);
  });
});
