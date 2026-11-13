// DP-151: the contact form's contract.
import { describe, expect, it } from "vitest";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MESSAGE_MAX,
  LEAD_PRIVACY_NOTICE,
  LeadContactMessageInputSchema,
} from "../src/index.js";

const valid = {
  fullName: "  Grace   Hopper ",
  company: "Compiler Works BV",
  email: "Grace@Compiler.example",
  country: "NL",
  phone: " +31 (20) 000-0000 ",
  subject: "Supply",
  message: "Line one.\r\n\r\n\r\n\r\nLine two.   \nLine three.",
  privacyNoticeVersion: LEAD_CONTACT_NOTICE.version,
  website: "",
};
const parse = (patch: Record<string, unknown>) =>
  LeadContactMessageInputSchema.safeParse({ ...valid, ...patch });

describe("DP-151 contact form input", () => {
  it("normalises single-line fields and keeps line breaks in the message", () => {
    const out = LeadContactMessageInputSchema.parse(valid);
    expect(out.fullName).toBe("Grace Hopper");
    expect(out.phone).toBe("+31 (20) 000-0000");
    expect(out.message).toBe("Line one.\n\nLine two.\nLine three.");
  });

  it("stores blank optional fields as null", () => {
    const out = LeadContactMessageInputSchema.parse({ ...valid, phone: " ", subject: "" });
    expect(out.phone).toBeNull();
    expect(out.subject).toBeNull();
  });

  it("requires name, company, e-mail, country, message and the notice version shown", () => {
    for (const field of ["fullName", "company", "email", "country", "message"]) {
      expect(parse({ [field]: "" }).success, field).toBe(false);
    }
    expect(parse({ privacyNoticeVersion: undefined }).success).toBe(false);
  });

  it("has no consent fields: no notice tick box and no marketing consent (owner decision)", () => {
    expect(parse({ privacyNoticeAccepted: true }).success).toBe(false);
    expect(parse({ marketingConsent: false }).success).toBe(false);
    expect(parse({ marketingConsentVersion: null }).success).toBe(false);
  });

  it("refuses a short or long message, markup, control characters and letters in the phone", () => {
    expect(parse({ message: "Too short" }).success).toBe(false);
    expect(parse({ message: "x".repeat(LEAD_MESSAGE_MAX + 1) }).success).toBe(false);
    expect(parse({ message: "Hello <script>alert(1)</script> there" }).success).toBe(false);
    expect(parse({ message: "Hello\u0007 there, bell" }).success).toBe(false);
    expect(parse({ phone: "call me" }).success).toBe(false);
  });

  it("refuses a filled honeypot and unknown fields", () => {
    expect(parse({ website: "https://spam.example" }).success).toBe(false);
    expect(parse({ documentId: "00000000-0000-0000-0000-000000000000" }).success).toBe(false);
  });

  it("has its own notice, distinct from the document form's", () => {
    expect(LEAD_CONTACT_NOTICE.version).not.toBe(LEAD_PRIVACY_NOTICE.version);
    expect(LEAD_CONTACT_NOTICE.text).not.toBe(LEAD_PRIVACY_NOTICE.text);
    expect(LEAD_CONTACT_NOTICE.text).toMatch(/24 months/);
    expect(LEAD_CONTACT_NOTICE.text).not.toMatch(/document|PDF/);
    // A draft until approved: it blocks production publication.
    expect(LEAD_CONTACT_NOTICE.final).toBe(false);
  });
});
