// PM-5 (DP-035): the PDF upload proxy (its own 20 MB route; the image route and the general
// proxy keep their limits), the browser-side checks, messages and wording of the documents tab.
import { randomBytes } from "node:crypto";
import { DOCUMENT_ACCESS_POLICIES, DOCUMENT_SITE_STATES } from "@dream/contracts";
import { createTranslator } from "../lib/i18n/translate";
import { describe, expect, it } from "vitest";
import type { ProxyConfig } from "../lib/api-proxy";
import { messageForIssues } from "../lib/catalog-client";
import { proxyDocumentUpload, proxyImageUpload } from "../lib/upload-proxy";
import {
  documentLanguageName,
  documentLanguageOptions,
  documentPrecheck,
  documentUploadMessage,
  policyText,
  revisionHref,
  siteStateText,
} from "../components/catalog/document-manager";

const KEY = randomBytes(32).toString("base64url");
const CONFIG: ProxyConfig = { apiUrl: "http://api.internal:3000", proxyKey: KEY, trustedHops: 1 };
const DOC = "0190f2a1-0000-7000-8000-00000000000d";

function upstream(status = 201) {
  const seen: Array<{ url: string; init: RequestInit & { headers: Headers }; bytes: number }> = [];
  const fetchImpl = (async (url: string, init: RequestInit & { headers: Headers }) => {
    let bytes = 0;
    if (init.body instanceof ReadableStream) {
      const reader = init.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    }
    seen.push({ url, init, bytes });
    return new Response(JSON.stringify({ document: { id: DOC } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { seen, deps: { fetch: fetchImpl, log: () => {} } };
}

function upload(body: Uint8Array, headers: Record<string, string> = {}, id = DOC) {
  return new Request(`https://admin.example/api/document-upload/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "content-length": String(body.byteLength),
      origin: "https://admin.example",
      cookie: "__Host-dp_admin_session=abc; tracking=1",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("document upload proxy", () => {
  it("streams the PDF to the revision route with only the allowed headers", async () => {
    const { seen, deps } = upstream();
    const res = await proxyDocumentUpload(
      upload(new Uint8Array(70_000), {
        "x-dp-upload-filename": "TDS%20ICCSYN%206.pdf",
        "x-dp-revision-note": encodeURIComponent("Section 8 updated"),
        "x-dp-other": "1",
      }),
      DOC,
      CONFIG,
      deps,
    );
    expect(res.status).toBe(201);
    const call = seen[0]!;
    expect(call.url).toBe(`${CONFIG.apiUrl}/api/v1/admin/catalog/documents/${DOC}/revisions`);
    expect(call.init.method).toBe("PUT");
    expect(call.bytes).toBe(70_000);
    const h = call.init.headers;
    expect(h.get("content-type")).toBe("application/pdf");
    expect(h.get("x-dp-proxy-key")).toBe(KEY);
    expect(h.get("cookie")).toBe("__Host-dp_admin_session=abc");
    expect(h.get("x-dp-upload-filename")).toBe("TDS%20ICCSYN%206.pdf");
    expect(h.get("x-dp-revision-note")).toBe("Section%208%20updated");
    expect(h.get("x-dp-other")).toBeNull();
  });

  it("allows 20 MB for PDFs only; images keep 10 MB and their own types", async () => {
    const { seen, deps } = upstream();
    const big = String(20 * 1024 * 1024 + 1);
    expect(
      (
        await proxyDocumentUpload(
          upload(new Uint8Array(10), { "content-length": big }),
          DOC,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await proxyDocumentUpload(
          upload(new Uint8Array(10), { "content-type": "image/png" }),
          DOC,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await proxyImageUpload(
          upload(new Uint8Array(10), { "content-type": "application/pdf" }),
          DOC,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (await proxyDocumentUpload(upload(new Uint8Array(10)), "../../products", CONFIG, deps))
        .status,
    ).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("drops a change note with raw (not percent-encoded) characters", async () => {
    const { seen, deps } = upstream();
    await proxyDocumentUpload(
      upload(new Uint8Array(10), { "x-dp-revision-note": "a<script>" }),
      DOC,
      CONFIG,
      deps,
    );
    expect(seen.at(-1)!.init.headers.get("x-dp-revision-note")).toBeNull();
  });
});

describe("documents tab helpers", () => {
  it("pre-checks the file in the browser (the API checks the content again)", () => {
    expect(documentPrecheck({ name: "a.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(documentPrecheck({ name: "a.pdf", type: "", size: 10 })).toBeNull();
    expect(documentPrecheck({ name: "a.docx", type: "application/msword", size: 10 })).toMatch(
      /Not a PDF/,
    );
    expect(documentPrecheck({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(
      documentPrecheck({ name: "a.pdf", type: "application/pdf", size: 20 * 1024 * 1024 + 1 }),
    ).toMatch(/20 MB/);
  });

  it("explains every refusal of an upload", () => {
    const err = (rule: string, code = "VALIDATION_FAILED") => ({
      error: { code, message: "x", requestId: "r", details: [{ path: "file", rule }] },
    });
    expect(documentUploadMessage(400, err("active_content"))).toMatch(/active content/);
    expect(documentUploadMessage(400, err("encrypted"))).toMatch(/encrypted/);
    expect(documentUploadMessage(415, err("not_pdf", "UNSUPPORTED_MEDIA_TYPE"))).toMatch(
      /Not a PDF/,
    );
    expect(documentUploadMessage(413, null)).toMatch(/20 MB/);
    expect(documentUploadMessage(0, null)).toMatch(/interrupted/);
    expect(
      messageForIssues("CONFLICT_STATE", [{ path: "(root)", rule: "not_publishable" }]),
    ).toMatch(/non-internal/);
  });

  it("has wording for every policy and site state, and same-origin file links", () => {
    for (const p of DOCUMENT_ACCESS_POLICIES) expect(policyText(p).label).toBeTruthy();
    for (const s of DOCUMENT_SITE_STATES) expect(siteStateText(s).label).toBeTruthy();
    expect(policyText("MEMBERS_ONLY").help).toMatch(/not downloadable/);
    expect(revisionHref(DOC, "inline")).toBe(
      `/api/v1/admin/catalog/document-revisions/${DOC}/inline`,
    );
  });
});

describe("ML-9 document language (admin)", () => {
  it("names a language in English with its tag", () => {
    expect(documentLanguageName("en")).toBe("English (en)");
    expect(documentLanguageName("nl")).toBe("Dutch (nl)");
    expect(documentLanguageName("zz-Unknowntag")).toBe("zz-Unknowntag");
  });

  it("offers the enabled languages, English always, and the document's own one", () => {
    const enabled = [
      { locale: "en", isDefault: true, public: true },
      { locale: "nl", isDefault: false, public: false },
    ];
    expect(documentLanguageOptions(enabled).map((l) => l.locale)).toEqual(["en", "nl"]);
    // an answer without languages (API of before ML-9): English only
    expect(documentLanguageOptions([]).map((l) => l.locale)).toEqual(["en"]);
    // a language no longer enabled stays visible for the document that has it
    expect(documentLanguageOptions(enabled, "de").map((l) => l.locale)).toEqual(["en", "nl", "de"]);
  });

  it("has wording for the language state of every site", () => {
    expect(siteStateText("language_not_public").label).toBe("Waits for its language to be public");
  });
});

describe("ML-12a: document wording in Turkish", () => {
  const tr = createTranslator("tr");
  it("translates policies, site states, upload messages and language names; codes stay", () => {
    expect(policyText("PUBLIC", tr).label).toBe("Herkese açık");
    expect(siteStateText("language_not_public", tr).label).not.toBe(
      siteStateText("language_not_public").label,
    );
    expect(documentUploadMessage(413, null, tr)).toMatch(/20 MB/);
    expect(documentUploadMessage(413, null, tr)).not.toBe(documentUploadMessage(413, null));
    expect(documentLanguageName("nl", "tr")).toBe("Felemenkçe (nl)");
    expect(documentLanguageName("zz-Unknowntag", "tr")).toBe("zz-Unknowntag");
  });
});
