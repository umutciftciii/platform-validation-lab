// DP-298 (ADR-031): the admin's data-processing screens.
//   1. Pure helpers (lib/legal-texts-view.ts): where a text is used ("Prepared for future use"),
//      which actions a row offers by permission, API rule messages, consent states and history
//      lines, the completeness of the AI providers' data-processing terms.
//   2. The browser client (lib/data-processing-client.ts): routes, methods (the draft update is a
//      POST), bodies (publish and review name the SHA-256), refusals by rule, the step-up flag.
//   3. No UI text written in code in the new files (support/ui-literals, as ML-12a–e).
//   4. Renders: Content > Legal texts (immutable evidence, review badges, blockers, actions only
//      with the permissions, history), the lead Consents panel and the AI terms section; EN and TR.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AI_API,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_TEXTS_API,
  type AiProviderDataTermsResponse,
  type LeadConsentsResponse,
  type LegalTextsOverview,
  type LegalTextVersionSummary,
} from "@dream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
import { listFiles, scanFiles } from "./support/ui-literals";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = vi.hoisted(() => new Map<string, unknown>());
const FORBIDDEN = Symbol("forbidden");

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(path);
    if (v === FORBIDDEN) return { ok: false, status: 403, code: "FORBIDDEN" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({
  requireStaffSession: async () => ({ user: { id: "0190f3a0-0000-7000-8000-000000009100" } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/legal-texts",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const view = await import("../lib/legal-texts-view");
const client = await import("../lib/data-processing-client");
const legalPage = await import("../app/(console)/legal-texts/page");
const { LeadConsents } = await import("../components/leads/lead-consents");
const { AiDataTerms } = await import("../components/ai/ai-data-terms");

const EN = createTranslator("en");
const TR = createTranslator("tr");
const ID = (n: number) => `0190f3a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SHA = "a".repeat(64);
const AT = "2026-11-27T09:00:00.000Z";
const PERSON = { id: ID(900), displayName: "Owner Person" };

function version(over: Partial<LegalTextVersionSummary> = {}): LegalTextVersionSummary {
  return {
    id: ID(1),
    key: "DOCUMENT_REQUEST_NOTICE",
    locale: "en",
    version: "2026-11-12.en",
    status: "PUBLISHED",
    legalReview: "REQUIRED",
    reviewNote: null,
    translatesVersion: null,
    sha256: SHA,
    createdAt: AT,
    createdBy: PERSON,
    updatedAt: AT,
    publishedAt: AT,
    publishedBy: PERSON,
    reviewApprovedAt: null,
    reviewApprovedBy: null,
    revision: 1,
    ...over,
  };
}

const ALL = { edit: true, publish: true };
const NONE_PUBLISH = { edit: true, publish: false };
const READ_PUBLISH = { edit: false, publish: true };

function overview(permissions: LegalTextsOverview["permissions"]): LegalTextsOverview {
  return {
    documents: LEGAL_DOCUMENT_KEYS.map((key, i) => ({
      key,
      locales: [
        {
          locale: "en",
          current:
            key === "DOCUMENT_REQUEST_NOTICE"
              ? version({ id: ID(10 + i), key })
              : key === "CONTACT_NOTICE"
                ? version({
                    id: ID(10 + i),
                    key,
                    legalReview: "APPROVED",
                    reviewApprovedAt: AT,
                    reviewApprovedBy: { id: ID(901), displayName: "Legal Reviewer" },
                  })
                : null,
          draft:
            key === "DOCUMENT_REQUEST_NOTICE"
              ? version({
                  id: ID(30 + i),
                  key,
                  version: null,
                  status: "DRAFT",
                  publishedAt: null,
                  publishedBy: null,
                  reviewNote: "Check the retention sentence.",
                  revision: 3,
                })
              : null,
        },
      ],
    })),
    locales: ["en"],
    blockers: ["DP-298: legal review of DOCUMENT_REQUEST_NOTICE 2026-11-12.en"],
    permissions,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1] ?? "").trim());

async function renderPage(search: Record<string, string> = {}, locale: AdminLocale = "en") {
  ui.locale = locale;
  const el: ReactElement = await legalPage.default({ searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{el}</LocaleProvider>);
}

beforeEach(() => {
  reads.clear();
  ui.locale = "en";
});
afterEach(() => vi.unstubAllGlobals());

describe("DP-298: legal text helpers", () => {
  it("names where a text is used; texts no process uses are prepared for future use", () => {
    expect(view.isFutureUse("AI_PROCESSING_NOTICE")).toBe(true);
    expect(view.isFutureUse("INTERNATIONAL_TRANSFER_CONSENT")).toBe(true);
    expect(view.isFutureUse("PRIVACY_POLICY")).toBe(false);
    expect(view.usedByLabel("AI_PROCESSING_CONSENT", EN)).toBe(
      "Prepared for future use — shown nowhere",
    );
    expect(view.usedByLabel("AI_PROCESSING_CONSENT", TR)).toBe(
      "İleride kullanım için hazırlandı — hiçbir yerde gösterilmiyor",
    );
    expect(view.usedByLabel("CONTACT_NOTICE", EN)).toBe(
      "Used on the contact form (shown, no checkbox)",
    );
    expect(view.kindLabel("MARKETING_CONSENT", EN)).toBe("Consent (optional, withdrawable)");
    expect(view.kindLabel("CONTACT_NOTICE", TR)).toBe("Bilgilendirme (rıza değildir)");
    expect(view.languageLabel("nl", EN)).toBe("Dutch");
    expect(view.languageLabel("xx", EN)).toBe("XX");
    expect(view.shortHash(SHA)).toBe(`${"a".repeat(12)}…`);
    expect(view.reviewLabel("REQUIRED", EN)).toBe("Legal review required");
    expect(view.reviewLabel("REQUIRED", TR)).toBe("Hukuki inceleme gerekli");
    expect(view.usesPolicyMarkup("PRIVACY_POLICY")).toBe(true);
    expect(view.usesPolicyMarkup("MARKETING_CONSENT")).toBe(false);
    expect(view.textLength("  a\r\nb  ")).toBe(3);
  });

  it("never edits a published version; actions follow legal_text:edit and legal_text:publish", () => {
    const current = version();
    const draft = version({ id: ID(2), version: null, status: "DRAFT" });
    // A current version with a draft: no second draft; review of the current one with publish.
    expect(view.legalTextActions({ current, draft }, ALL)).toEqual({
      current: ["review"],
      draft: ["edit", "publish", "review", "delete"],
    });
    // Without a draft: a new draft from the current version (edit only).
    expect(view.legalTextActions({ current, draft: null }, NONE_PUBLISH)).toEqual({
      current: ["newDraft"],
      draft: [],
    });
    expect(view.legalTextActions({ current, draft }, NONE_PUBLISH)).toEqual({
      current: [],
      draft: ["edit", "delete"],
    });
    expect(view.legalTextActions({ current, draft }, READ_PUBLISH)).toEqual({
      current: ["review"],
      draft: ["publish", "review"],
    });
    // An approved version needs no second review.
    const approved = version({ legalReview: "APPROVED" });
    expect(view.legalTextActions({ current: approved, draft: null }, ALL).current).toEqual([
      "newDraft",
    ]);
    const nothing = { edit: false, publish: false };
    const empty = view.legalTextActions({ current: null, draft: null }, nothing);
    expect(empty).toEqual({ current: [], draft: [] });
  });

  it("explains the API's rules, with the line of a markup error", () => {
    expect(view.parseLegalTextRule("duplicate_id:12")).toEqual({ rule: "duplicate_id", line: 12 });
    expect(view.parseLegalTextRule("stale")).toEqual({ rule: "stale", line: null });
    expect(view.legalTextRuleMessage("duplicate_id:12", EN)).toBe(
      "Line 12: this section id is used twice. Every section id must be unique.",
    );
    expect(view.legalTextRuleMessage("text_before_section:1", EN)).toBe(
      "Line 1: text before the first section. Start the policy with a line ## Title {#id}.",
    );
    expect(view.legalTextRuleMessage("unknown_rule", EN)).toBeUndefined();
    const help = EN("legal.texts.markupHelp", {
      heading: view.MARKUP_HEADING,
      item: view.MARKUP_ITEM,
    });
    expect(help).toContain("## Title {#id}");
  });
});

describe("DP-298: consent helpers", () => {
  const grant = {
    id: ID(50),
    purpose: "MARKETING_EMAIL" as const,
    action: "GRANTED" as const,
    source: "DOCUMENT_REQUEST" as const,
    textVersion: "2026-11-12.en",
    textSha256: SHA,
    sourceRecordId: ID(60),
    channel: null,
    actor: null,
    createdAt: AT,
  };
  const withdrawal = {
    ...grant,
    id: ID(51),
    action: "WITHDRAWN" as const,
    source: "STAFF" as const,
    textVersion: null,
    textSha256: null,
    sourceRecordId: null,
    channel: "PHONE" as const,
    actor: { id: ID(901), displayName: "Sales Person" },
    createdAt: "2026-11-27T10:00:00.000Z",
  };

  it("labels the state per purpose and allows a withdrawal only of a granted consent", () => {
    expect(view.consentStateLabel("GRANTED", EN)).toBe("Granted");
    expect(view.consentStateLabel("WITHDRAWN", TR)).toBe("Geri alındı");
    expect(view.consentStateLabel(null, EN)).toBe("Never given");
    const granted = { purpose: "MARKETING_EMAIL" as const, state: "GRANTED" as const, since: AT };
    expect(view.canWithdrawPurpose(granted, true)).toBe(true);
    expect(view.canWithdrawPurpose(granted, false)).toBe(false);
    expect(view.canWithdrawPurpose({ ...granted, state: "WITHDRAWN" }, true)).toBe(false);
    expect(view.canWithdrawPurpose({ ...granted, state: null, since: null }, true)).toBe(false);
  });

  it("describes a grant by its form and text version, a withdrawal by channel and who", () => {
    expect(view.consentRecordLines(grant, EN)).toEqual([
      "Granted via document request form",
      "Consent text 2026-11-12.en",
    ]);
    expect(view.consentRecordLines(withdrawal, EN)).toEqual([
      "Withdrawn · received by Phone",
      "Recorded by Sales Person",
    ]);
    expect(view.consentRecordLines(withdrawal, TR)).toEqual([
      "Geri alındı · iletilme yolu: Telefon",
      "Kaydeden: Sales Person",
    ]);
  });

  it("requires every AI data term, the date as a day and the no-training confirmation", () => {
    const full = {
      dpaReference: "DPA-2026-01",
      dpaSignedOn: "2026-11-01",
      transferMechanism: "SCC",
      kvkkTransferMechanism: "NOT_APPLICABLE",
      dataRegion: "EU",
      retentionSetting: "zero data retention",
      noTraining: true,
    };
    expect(view.dataTermsComplete(full)).toBe(true);
    expect(view.dataTermsComplete({ ...full, noTraining: false })).toBe(false);
    expect(view.dataTermsComplete({ ...full, dpaSignedOn: "01.11.2026" })).toBe(false);
    expect(view.dataTermsComplete({ ...full, dataRegion: "  " })).toBe(false);
    expect(view.dataTermsComplete({ ...full, kvkkTransferMechanism: "" })).toBe(false);
  });
});

describe("DP-298: browser client", () => {
  const err = (code: string, details: unknown[] = []) => ({
    error: { code, message: "x", requestId: "req-1", details },
  });

  it("maps refusals to their rule message; step-up and stale are recognisable", () => {
    const rule = (code: string, path: string, r: string) => err(code, [{ path, rule: r }]);
    const stale = client.dataProcessingError(rule("CONFLICT_STATE", "revision", "stale"), EN);
    expect(stale).toMatchObject({ rule: "stale", stepUp: false });
    expect(
      client.dataProcessingError(rule("VALIDATION_FAILED", "text", "duplicate_id:4"), EN).message,
    ).toBe("Line 4: this section id is used twice. Every section id must be unique.");
    expect(
      client.dataProcessingError(rule("CONFLICT_STATE", "purpose", "not_granted"), TR).message,
    ).toBe("Bu rıza şu anda verilmiş değil; geri alınacak bir şey yok.");
    expect(
      client.dataProcessingError(rule("CONFLICT_STATE", "provider", "no_terms"), EN).message,
    ).toBe("No terms are recorded for this provider.");
    expect(client.dataProcessingError(err("AUTH_STEP_UP_REQUIRED"), EN)).toMatchObject({
      stepUp: true,
      rule: null,
    });
    expect(client.dataProcessingError(err("FORBIDDEN"), EN).message).toBe(
      "You do not have permission for this action.",
    );
    expect(client.dataProcessingError(null, EN).message).toBe("The change could not be saved.");
  });

  it("calls the routes: POST for a draft update, the SHA-256 for publish and review", async () => {
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: init.body as string | undefined });
        return init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    await client.createLegalTextDraft({
      key: "CONTACT_NOTICE",
      locale: "nl",
      text: "Tekst",
      reviewNote: null,
      translatesId: ID(1),
    });
    await client.updateLegalTextDraft(ID(2), { text: "Tekst 2", reviewNote: "x", revision: 3 });
    expect(await client.deleteLegalTextDraft(ID(2))).toEqual({ ok: true, data: null });
    await client.publishLegalText(ID(2), SHA);
    await client.approveLegalReview(ID(2), SHA);
    await client.getLegalTextVersion(ID(2));
    await client.withdrawLeadConsent(ID(3), "MARKETING_EMAIL", { channel: "EMAIL" });
    await client.revokeAiDataTerms("OPENAI");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${LEGAL_TEXTS_API}/drafts`,
      `POST ${LEGAL_TEXTS_API}/drafts/${ID(2)}`,
      `DELETE ${LEGAL_TEXTS_API}/drafts/${ID(2)}`,
      `POST ${LEGAL_TEXTS_API}/versions/${ID(2)}/publish`,
      `POST ${LEGAL_TEXTS_API}/versions/${ID(2)}/legal-review`,
      `GET ${LEGAL_TEXTS_API}/versions/${ID(2)}`,
      `POST /api/v1/admin/leads/${ID(3)}/consents/MARKETING_EMAIL/withdraw`,
      `POST ${AI_API}/providers/OPENAI/data-terms/revoke`,
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ text: "Tekst 2", reviewNote: "x", revision: 3 });
    expect(JSON.parse(calls[3]!.body!)).toEqual({ sha256: SHA });
    expect(JSON.parse(calls[4]!.body!)).toEqual({ sha256: SHA });
    expect(calls[2]!.body).toBeUndefined();
    expect(calls[5]!.body).toBeUndefined();
    expect(JSON.parse(calls[6]!.body!)).toEqual({ channel: "EMAIL" });
  });

  it("returns the refusal with its status and rule", async () => {
    const stale = JSON.stringify(err("CONFLICT_STATE", [{ path: "revision", rule: "stale" }]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stale, { status: 409 })),
    );
    const body = { text: "x", reviewNote: null, revision: 1 };
    const res = await client.updateLegalTextDraft(ID(2), body);
    expect(res).toMatchObject({ ok: false, status: 409, rule: "stale", stepUp: false });
  });
});

describe("DP-298: Content > Legal texts", () => {
  it("shows the evidence, the review badges, the blockers and future-use texts", async () => {
    reads.set(LEGAL_TEXTS_API, overview(ALL));
    const html = await renderPage();
    const tx = text(html);
    expect(tx).toContain("Published versions are evidence and never change");
    expect(tx).toContain("Version 2026-11-12.en");
    expect(tx).toContain("Legal review required");
    expect(tx).toContain("Approved by Legal Reviewer on");
    expect(tx).toContain("Published by Owner Person on");
    expect(tx).toContain("Check the retention sentence.");
    expect(html).toContain(`title="${SHA}"`);
    expect(tx).toContain("DP-298: legal review of DOCUMENT_REQUEST_NOTICE 2026-11-12.en");
    expect(tx.match(/Prepared for future use — shown nowhere/g)).toHaveLength(4);
    // The privacy policy has no version yet: a new (empty) draft, never "from current".
    expect(tx).toContain("Not published");
    const b = buttons(html);
    expect(b).toEqual(
      expect.arrayContaining(["Edit draft", "Publish", "Record legal review", "Delete draft"]),
    );
    // The contact notice (approved, no draft) offers a new draft from its current version.
    expect(b).toContain("New draft from current");
    // Exactly one draft per text: no "new draft" where a draft exists, so 7 of 8 documents.
    expect(b.filter((x) => x === "New draft" || x === "New draft from current")).toHaveLength(7);
    expect(html).toContain('href="/legal-texts?doc=PRIVACY_POLICY&amp;locale=en"');
  });

  it("offers no change without the permissions; publishing only with legal_text:publish", async () => {
    reads.set(LEGAL_TEXTS_API, overview(NONE_PUBLISH));
    const edit = buttons(await renderPage());
    expect(edit).not.toContain("Publish");
    expect(edit).not.toContain("Record legal review");
    expect(edit).toContain("Edit draft");
    reads.set(LEGAL_TEXTS_API, overview(READ_PUBLISH));
    const publish = buttons(await renderPage());
    expect(publish).not.toContain("Edit draft");
    expect(publish).not.toContain("New draft");
    expect(publish).toEqual(expect.arrayContaining(["Publish", "Record legal review"]));
  });

  it("says when the user may not read the legal texts; TR", async () => {
    reads.set(LEGAL_TEXTS_API, FORBIDDEN);
    expect(text(await renderPage())).toContain("No access to the legal texts");
    reads.set(LEGAL_TEXTS_API, overview(ALL));
    const tr = text(await renderPage({}, "tr"));
    expect(tr).toContain("Hukuki metinler");
    expect(tr).toContain("Hukuki inceleme gerekli");
    expect(tr).toContain("Güncel sürümden yeni taslak");
  });

  it("lists the history of one text and language, published versions with their facts", async () => {
    reads.set(LEGAL_TEXTS_API, overview(ALL));
    reads.set(`${LEGAL_TEXTS_API}/documents/DOCUMENT_REQUEST_NOTICE/en`, {
      versions: [
        version({
          id: ID(2),
          version: null,
          status: "DRAFT",
          publishedAt: null,
          publishedBy: null,
        }),
        version(),
      ],
    });
    const html = await renderPage({ doc: "DOCUMENT_REQUEST_NOTICE", locale: "en" });
    const tx = text(html);
    expect(tx).toContain("History: PDF download data processing notice (English)");
    expect(tx).toContain("Draft (named when published)");
    expect(tx).toContain("2026-11-12.en");
    expect(buttons(html).filter((x) => x === "View text")).toHaveLength(2);
    expect(tx).toContain("All legal texts");
  });
});

describe("DP-298: lead consents and AI terms", () => {
  const consents: LeadConsentsResponse = {
    states: [
      { purpose: "MARKETING_EMAIL", state: "GRANTED", since: AT },
      { purpose: "AI_PERSONAL_DATA", state: null, since: null },
      { purpose: "INTERNATIONAL_TRANSFER", state: "WITHDRAWN", since: AT },
    ],
    history: [],
    canWithdraw: true,
  };
  const render = (node: ReactElement, locale: AdminLocale = "en") =>
    renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);

  it("shows the state per purpose; withdraw only a granted consent with lead:manage", () => {
    const html = render(<LeadConsents leadId={ID(3)} consents={consents} />);
    const tx = text(html);
    for (const s of ["Granted", "Never given", "Withdrawn", "No consent records yet."])
      expect(tx).toContain(s);
    expect(buttons(html)).toEqual(["Withdraw consent"]);
    expect(html).toContain('aria-label="Withdraw consent: Marketing e-mail"');
    const readOnly = { ...consents, canWithdraw: false };
    const read = render(<LeadConsents leadId={ID(3)} consents={readOnly} />);
    expect(buttons(read)).toEqual([]);
    expect(text(read)).toContain("Recording a withdrawal needs lead:manage");
    const tr = text(render(<LeadConsents leadId={ID(3)} consents={consents} />, "tr"));
    expect(tr).toContain("Rızayı geri al");
    expect(tr).toContain("Hiç verilmedi");
  });

  it("AI terms: not allowed without terms; the recorded terms with GDPR and KVKK apart", () => {
    const none: AiProviderDataTermsResponse = {
      provider: "OPENAI",
      current: null,
      history: [],
      canManage: false,
    };
    const empty = render(<AiDataTerms provider="OPENAI" terms={none} />);
    expect(text(empty)).toContain("Personal data: not allowed (no terms recorded)");
    expect(text(empty)).toContain("Terms alone enable nothing");
    expect(buttons(empty)).toEqual([]);
    const terms = {
      id: ID(70),
      provider: "OPENAI" as const,
      dpaReference: "DPA-2026-01",
      dpaSignedOn: "2026-11-01",
      transferMechanism: "SCC" as const,
      kvkkTransferMechanism: "STANDARD_CONTRACT_NOTIFIED" as const,
      dataRegion: "EU",
      retentionSetting: "zero data retention",
      noTraining: true as const,
      recordedAt: AT,
      recordedBy: "Owner Person",
      revokedAt: null,
    };
    const recorded = render(
      <AiDataTerms
        provider="OPENAI"
        terms={{ provider: "OPENAI", current: terms, history: [terms], canManage: true }}
      />,
    );
    const tx = text(recorded);
    expect(tx).toContain("Transfer mechanism (GDPR, Chapter V) Standard contractual clauses");
    expect(tx).toContain(
      "Transfer mechanism (KVKK Art. 9) Standard contract notified to the Authority",
    );
    expect(tx).toContain("Recorded by Owner Person on");
    expect(buttons(recorded)).toEqual(["Replace terms", "Revoke terms"]);
    expect(text(render(<AiDataTerms provider="OPENAI" terms={null} />))).toContain(
      "The data-processing terms could not be loaded.",
    );
  });
});

describe("DP-298: no hard-coded UI text", () => {
  it("the new screens take every text from the dictionary", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const files = listFiles(root, [
      "app/(console)/legal-texts",
      "components/legal",
      "components/ai/ai-data-terms.tsx",
      "components/leads/lead-consents.tsx",
      "lib/legal-texts-view.ts",
      "lib/data-processing-client.ts",
    ]);
    expect(files.length).toBe(6);
    expect(scanFiles(root, files).map((l) => `${l.file}:${l.line}  ${l.text}`)).toEqual([]);
  });
});
