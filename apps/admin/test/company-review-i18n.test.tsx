// ML-12b (DP-243): the Company Review screens in Turkish. Every screen and state of
// company-review-en.test.tsx is rendered twice on the server with the same fixtures — once in
// English, once with the `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a visible text (text node, aria-label, title,
//      placeholder, alt) equal in both languages must be data from the fixtures (product names and
//      codes, research items, sources, people, comments) or a fixed term (SAME_IN_BOTH);
//   2. the translation changes text only: the element structure, every link, form field, value,
//      data-* attribute and API enum (`?status=APPROVED`, `name="category"`) is identical;
//   3. Turkish dates and numbers come from the format module, and the server render equals the
//      client render (the same language on both sides: no hydration mismatch).
// English itself is covered byte for byte by the EN baseline (company-review-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalDecision } from "../components/catalog/proposal-decision";
import { ProposalTextEditor } from "../components/catalog/proposal-editor";
import { ReviewTabPanel, ReviewTabs } from "../components/catalog/review-tabs";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import {
  C,
  FAIL,
  P1,
  P2,
  P3,
  PR1,
  context,
  proposal,
  seedReviewReads,
} from "./support/review-fixtures";
import { renderResearchNotes, reviewTexts } from "./support/review-en-texts";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = new Map<string, unknown>();

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
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const listModule = await import("../app/(console)/company-review/page");
const detailModule = await import("../app/(console)/company-review/[id]/page");

beforeEach(() => seedReviewReads(reads));

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "Dream Petroleum BV",
  "Dream Petroleum",
  "BV",
  "SKU",
  "Slug",
  "Site",
  "TDS",
  "DP-002",
  "mm²/s",
  "°C",
]);

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");

/** Visible texts: text nodes and the attributes people read or hear. */
function texts(html: string): string[] {
  const out: string[] = [];
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  for (const m of body.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of body.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Every string value of the API fixtures: data that is shown as it is. */
function fixtureData(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  const unquoted = text.replace(/^[“"‘']|[”"’']$/g, "");
  if (unquoted !== text) return isData(unquoted, data);
  if (data.some((d) => d === text || (text.length > 3 && d.includes(text)))) return true;
  // "viscosity index" is the item's field key `spec:viscosity_index` written for people (data)
  if (data.some((d) => d.startsWith("spec:") && d.slice(5).replace(/_/g, " ") === text))
    return true;
  // a composition of data and fixed tokens, e.g. "Research editor (fixture) · 15 Nov 2026"
  const rest = text
    .split(/\s*(?:·|,|\/|—|–|:|;|\(|\)|\|)\s*/)
    .filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 1 && rest.every((p) => isData(p, data));
}

/** The markup without any visible text: tags and every attribute people do not read. */
function structure(html: string): string {
  return html
    .replace(/\s(?:aria-label|title|placeholder|alt)="[^"]*"/g, "")
    .replace(/>[^<]*</g, "><")
    .replace(/<!-- -->/g, "");
}

type Render = () => Promise<ReactElement> | ReactElement;

async function render(make: Render, locale: AdminLocale): Promise<string> {
  ui.locale = locale;
  const tree = await make();
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
}

/** English left in Turkish, and whether the two renders differ in anything but text. */
async function compare(make: Render) {
  const en = await render(make, "en");
  const tr = await render(make, "tr");
  const enTexts = new Set(texts(en));
  const data = fixtureData();
  const left = [...new Set(texts(tr))].filter((t) => enTexts.has(t) && !isData(t, data));
  return { en, tr, left };
}

const list =
  (q: Record<string, string> = {}) =>
  () =>
    listModule.default({ searchParams: Promise.resolve(q) } as never) as Promise<ReactElement>;
const detail =
  (id: string, q: Record<string, string> = {}) =>
  () =>
    detailModule.default({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(q),
    } as never) as Promise<ReactElement>;

describe("Company Review in Turkish: every screen and state", () => {
  const screens: [string, () => void, Render][] = [
    ["list", () => undefined, list()],
    ["list filtered by status", () => undefined, list({ status: "APPROVED" })],
    ["list without matches", () => undefined, list({ q: "zzz-none" })],
    [
      "list narrowed by search and category",
      () => undefined,
      list({ q: "hvi", category: "0190f2a1-0000-7000-8000-000000000511" }),
    ],
    [
      "list without product categories",
      () =>
        reads.delete(
          `${C}/products?siteId=0190f2a1-0000-7000-8000-0000000000b1&sort=name&order=asc&page=1&pageSize=100`,
        ),
      list(),
    ],
    [
      "list that cannot be loaded",
      () => reads.set(`${C}/proposals?siteId=0190f2a1-0000-7000-8000-0000000000b1`, FAIL),
      list(),
    ],
    ["no access", () => reads.set(`${C}/proposals/context`, context({ canRead: false })), list()],
    ["proposal, every tab", () => undefined, detail(P1)],
    ...(["no_permission", "not_in_review", "own_change", null] as const).map(
      (r): [string, () => void, Render] => [
        `blocked decision (${String(r)})`,
        () =>
          reads.set(
            `${C}/proposals/${P1}`,
            proposal(P1, PR1, {}, { canDecide: false, decisionBlocked: r }),
          ),
        detail(P1),
      ],
    ),
    [
      "editor",
      () => reads.set(`${C}/proposals/${P1}`, proposal(P1, PR1, {}, { canRevise: true })),
      detail(P1),
    ],
    [
      "editor of an approved proposal",
      () =>
        reads.set(
          `${C}/proposals/${P1}`,
          proposal(
            P1,
            PR1,
            { status: "APPROVED" },
            { canRevise: true, canDecide: false, decisionBlocked: "not_in_review" },
          ),
        ),
      detail(P1),
    ],
    ["placeholder, approved", () => undefined, detail(P2)],
    [
      "placeholder in the editor",
      () =>
        reads.set(`${C}/proposals/${P2}`, {
          ...(reads.get(`${C}/proposals/${P2}`) as object),
          canRevise: true,
        }),
      detail(P2),
    ],
    ["full history", () => undefined, detail(P3, { tab: "history" })],
    [
      "empty research, product not readable",
      () => {
        reads.set(
          `${C}/proposals/${P1}`,
          proposal(
            P1,
            PR1,
            { reviewData: { schemaVersion: 1, family: null, items: [], sources: [] } },
            {},
            [],
          ),
        );
        reads.delete(`${C}/products/${PR1}?siteId=0190f2a1-0000-7000-8000-0000000000b1`);
      },
      detail(P1),
    ],
    [
      "proposal that cannot be loaded",
      () => reads.set(`${C}/proposals/${P1}`, FAIL),
      detail(P1, { site: "bv" }),
    ],
    [
      "research notes (product page)",
      () => undefined,
      () => renderResearchNotes(proposal(P1, PR1).proposal as never, ui.locale),
    ],
  ];

  it.each(screens)("%s: no English UI text, same structure", async (_name, arrange, make) => {
    arrange();
    const { en, tr, left } = await compare(make);
    expect(left).toEqual([]);
    expect(tr).not.toBe(en);
    expect(structure(tr)).toBe(structure(en));
  });

  it("uses the glossary terms", async () => {
    const { tr } = await compare(detail(P3, { tab: "history" }));
    for (const word of [
      "Tüm öneriler",
      "İçerik incelemesi",
      "Eksikler ve doğrulama",
      "Kaynaklar",
      "Geçmiş",
      "Değişiklik istendi",
      "Onaylandı",
      "Araştırma önerisi — yayınlanmadı",
      "Dahili inceleme — asla yayınlanmaz",
    ])
      expect(tr).toContain(word);
    const listHtml = await render(list(), "tr");
    for (const word of [
      "İnceleme bekliyor",
      "Tümü",
      "Metin önerilmedi",
      "1 çelişki",
      "2 bekletilen değer",
    ])
      expect(listHtml).toContain(word);
  });

  it("titles the pages in the console language", async () => {
    for (const m of [listModule, detailModule] as unknown as {
      generateMetadata: () => Promise<{ title: string }>;
    }[]) {
      ui.locale = "tr";
      expect((await m.generateMetadata()).title).toBe("Şirket incelemesi");
      ui.locale = "en";
      expect((await m.generateMetadata()).title).toBe("Company review");
    }
  });

  it("keeps data and API values as they are", async () => {
    const tr = await render(detail(P1), "tr");
    // research items, sources, product names and codes are never translated
    for (const data of [
      "VI 124 is in the Group III range under API 1509.",
      "Manufacturer TDS",
      "G2-HVI-6",
      "Group II base oil",
      "Pour Point, max: Minus 15 °C [GOST 20287]",
    ])
      expect(tr).toContain(data);
    // the status filter links still carry the API enum, the form the API field names
    const listHtml = await render(list(), "tr");
    expect(listHtml).toContain("status=APPROVED");
    expect(listHtml).toContain('name="category"');
    expect(listHtml).toContain('name="q"');
  });

  it("writes dates and numbers in Turkish", async () => {
    const history = await render(detail(P3, { tab: "history" }), "tr");
    expect(history).toContain("18 Kas 2026"); // the decision date (en-GB: 18 Nov 2026)
    const technical = await render(detail(P1), "tr");
    expect(technical).toContain("1.234,5 mm²/s"); // en-GB: 1,234.5 mm²/s
    expect(technical).toContain("5,5 – &lt; 7,25 mm²/s"); // en-GB: 5.5 to < 7.25 mm²/s
    expect(technical).toContain("Hayır"); // a BOOLEAN value
  });
});

describe("Company Review client components render the same on server and client", () => {
  // The client's first render uses the language the root layout passed to LocaleProvider, the
  // same as the server's: equal markup means no hydration mismatch.
  it.each(["en", "tr"] as const)("%s", (locale) => {
    const tree = (
      <ReviewTabs
        proposalId={P1}
        site="bv"
        initialTab="content"
        badges={{ verification: { count: 3, alert: "x" } }}
      >
        <ReviewTabPanel tab="content">
          <ProposalTextEditor
            proposalId={P1}
            version={2}
            status="REVIEW_PENDING"
            text={{ summary: "Base oil.", description: null }}
            current={{ summary: null, description: "Site text." }}
            placeholder={false}
            tags={null}
          />
          <ProposalDecision proposalId={P1} version={2} canDecide decisionBlocked={null} />
        </ReviewTabPanel>
      </ReviewTabs>
    );
    const a = renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
    const b = renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
    expect(a).toBe(b);
    if (locale === "tr") {
      for (const word of [
        "Önerilen metin",
        "Kaydet",
        "İptal",
        "Yorum",
        "Onayla",
        "Değişiklik iste",
        "İnceleme bölümleri",
        "Sürüm 2 kaydedildi.",
      ])
        expect(a).toContain(word);
    }
  });
});

describe("Company Review view-model texts in Turkish", () => {
  it("translates every label, message and count; English stays the recording", () => {
    const en = reviewTexts("en");
    const tr = reviewTexts("tr");
    expect(tr).toHaveLength(en.length);
    // the same in both: the level-less "undefined" marker, the data key written for people
    // ("viscosity index", "summary"), values made only of numbers and units, "null" results and
    // the catalogue client's message passed through as it was given (already in the UI language)
    const same = tr.filter((t, i) => t === en[i]);
    for (const s of same)
      expect(s).toMatch(
        /^(?:undefined|null|viscosity index|summary|fallback|The change could not be saved\. Try again in a moment\.|[\d.,\s≥≤<>–-]+(?:mm²\/s)?|Clear and bright)$/,
      );
    expect(tr).toContain("Neyin değişmesi gerektiğini açıklayın (en az 3 karakter).");
    expect(tr).toContain("Bu sitede önerileri düzenleme yetkiniz yok.");
    expect(tr).toContain("2 çelişki");
    expect(tr).toContain("A · üreticinin kendi belgesi");
  });
});
