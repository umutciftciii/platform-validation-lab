// ML-12e (DP-243): the Overview (dashboard) in Turkish. Every screen and state of dashboard-en.test.tsx
// is rendered twice on the server with the same data — once in English, once with the
// `dp-admin-locale=tr` cookie (and the Turkish translator for the shared widgets) — and compared:
//   1. no English UI text is left in Turkish: a visible text equal in both languages must be data
//      (the user's name and e-mail, product names and codes, the BV domain, sample people) or a
//      fixed term;
//   2. the translation changes text only: the element structure, links and data-* attributes
//      (the sample-data marker included) are identical;
//   3. dates, greetings, relative times and numbers come from the format module in Turkish;
//   4. the sample data keeps its shape and `demo: true`, only its texts are translated.
// English itself is covered byte for byte by the EN baseline (dashboard-en.test.tsx).
import type { StaffSessionResponse } from "@dream/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { en as EN_MESSAGES } from "../lib/i18n/messages/en";
import { tr as TR_MESSAGES } from "../lib/i18n/messages/tr";
import { createTranslator } from "../lib/i18n/translate";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const REVIEW_QUEUE = "/api/v1/admin/catalog/review-queue";
const reads = new Map<string, unknown>();
const FAIL = Symbol("fail");
const FORBIDDEN = Symbol("forbidden");
let session: StaffSessionResponse;

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
    if (v === FORBIDDEN) return { ok: false, status: 403, code: "FORBIDDEN" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => session }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const overviewModule = await import("../app/(console)/page");
const { ActivityFeed } = await import("../components/dashboard/activity-feed");
const { KpiStrip } = await import("../components/dashboard/kpi-strip");
const { ProductReviewPanel, ProductReviewSkeleton } =
  await import("../components/dashboard/product-review");
const { QuickActions } = await import("../components/dashboard/quick-actions");
const { SessionCard } = await import("../components/dashboard/session-card");
const { SiteStatusPanel } = await import("../components/dashboard/site-status");
const demoData = await import("../lib/demo-data");

const T = { en: createTranslator("en"), tr: createTranslator("tr") } as const;

const MORNING = new Date("2026-11-24T08:05:00.000Z"); // 09:05 Amsterdam
const NOW = new Date("2026-11-24T13:30:00.000Z"); // 14:30
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const USER_ID = "0190f2a1-0000-7000-8000-000000000901";
const makeSession = (over: Partial<StaffSessionResponse> = {}): StaffSessionResponse => ({
  user: { id: USER_ID, email: "sanne.devries@fixture.invalid", displayName: "Sanne de Vries" },
  mfaVerifiedAt: iso(-60),
  stepUpValidUntil: iso(10),
  idleExpiresAt: iso(30),
  absoluteExpiresAt: iso(6 * 60 + 30),
  ...over,
});
const reviewItem = (n: number, over: Record<string, unknown> = {}) => ({
  productId: `0190f2a1-0000-7000-8000-0000000003${String(n).padStart(2, "0")}`,
  code: `PRD-${n}`,
  name: `Fixture product ${n}`,
  version: n,
  submittedAt: iso(-n * 300),
  submittedBy: { id: USER_ID, name: "Jonas Peters" },
  comment: null,
  blockingCount: 0,
  warningCount: 0,
  canReview: true,
  reviewBlockedReason: null,
  ...over,
});
const REVIEW_ITEMS = [
  reviewItem(1, { warningCount: 2 }),
  reviewItem(2, { blockingCount: 3, canReview: false }),
  reviewItem(3, { canReview: false, reviewBlockedReason: "own_change" }),
  reviewItem(4, { canReview: false, reviewBlockedReason: "no_permission", submittedBy: null }),
  reviewItem(5, { canReview: false, reviewBlockedReason: "not_in_review" }),
  reviewItem(6, { canReview: false, reviewBlockedReason: "archived" }),
];

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "dreampetroleumbv.com",
  "Sanne de Vries",
  "Jonas Peters",
  "JP", // the submitter's initials (avatar)
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
  for (const m of html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of html.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Data shown as it is: the session, the review queue and the sample people. */
function data(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([session, [...reads.values()], EN_MESSAGES.dashboard.demo.people]);
  return out;
}

function isData(text: string, values: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  if (values.some((d) => d === text)) return true;
  const rest = text.split(/\s*(?:·|,|:)\s*/).filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 0 && rest.every((p) => SAME_IN_BOTH.has(p) || values.includes(p));
}

/** The markup without any visible text. */
function structure(html: string): string {
  return html
    .replace(/\s(?:aria-label|title|placeholder|alt)="[^"]*"/g, "")
    .replace(/>[^<]*</g, "><")
    .replace(/<!-- -->/g, "");
}

type Render = (locale: AdminLocale) => Promise<ReactElement> | ReactElement;

async function render(make: Render, locale: AdminLocale): Promise<string> {
  ui.locale = locale;
  const tree = await make(locale);
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
}

async function compare(make: Render) {
  const en = await render(make, "en");
  const tr = await render(make, "tr");
  const enTexts = new Set(texts(en));
  const values = data();
  const left = [...new Set(texts(tr))].filter((t) => enTexts.has(t) && !isData(t, values));
  expect(left).toEqual([]);
  expect(structure(tr)).toBe(structure(en));
  return { en, tr };
}

const L = (locale: AdminLocale) => ({ t: T[locale], locale });
const page: Render = async () => (await overviewModule.default()) as ReactElement;
const panel: Render = async () => (await ProductReviewPanel({ now: NOW })) as ReactElement;

beforeEach(() => {
  reads.clear();
  session = makeSession();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  ui.locale = "en";
});

describe("Overview page (TR)", () => {
  it("translates the title", async () => {
    ui.locale = "tr";
    expect(await overviewModule.generateMetadata()).toEqual({ title: "Genel bakış" });
    ui.locale = "en";
    expect(await overviewModule.generateMetadata()).toEqual({ title: "Overview" });
  });

  it("translates the page; the date and greeting are Turkish, the name is the user's", async () => {
    vi.setSystemTime(MORNING);
    const { tr } = await compare(page);
    expect(tr).toContain("24 Kasım Salı");
    expect(tr).toContain("Günaydın, Sanne");
    expect(tr).toContain("Örnek veri.");
    expect(tr).toContain("İnceleme kuyruğu yükleniyor");
    expect(tr).toContain("Sayfa yaz");
    vi.setSystemTime(NOW);
    expect((await compare(page)).tr).toContain("İyi günler, Sanne");
  });

  it("keeps the e-mail name and the recovery-code variant", async () => {
    session = makeSession({
      user: { id: USER_ID, email: "jonas@fixture.invalid", displayName: null },
      mfaVerifiedAt: null,
      stepUpValidUntil: null,
    });
    const { tr } = await compare(page);
    expect(tr).toContain("İyi günler, jonas");
    expect(tr).toContain("Kurtarma kodu");
    expect(tr).toContain("Bir kurtarma koduyla oturum açtınız.");
  });
});

describe("Widgets (TR)", () => {
  it("KPI strip: labels, numbers and trend labels", async () => {
    const big = (l: AdminLocale) => {
      const d = demoData.demoDatasets(T[l]).DEMO_KPIS;
      return { demo: true as const, items: [{ ...d.items[0]!, value: 1234567 }, ...d.items] };
    };
    const { tr } = await compare((l) => <KpiStrip {...L(l)} data={big(l)} />);
    expect(tr).toContain("Son 30 gün");
    expect(tr).toContain("1.234.567");
    expect(tr).toContain('aria-label="Yayındaki sayfalar, 12 haftalık eğilim"');
  });

  it("activity: event texts, relative times, empty state; people unchanged", async () => {
    const { tr } = await compare((l) => (
      <ActivityFeed {...L(l)} data={demoData.demoDatasets(T[l]).DEMO_ACTIVITY} now={NOW} />
    ));
    expect(tr).toContain("Sanne de Vries");
    expect(tr).toContain("yayınladı:");
    expect(tr).toContain("34 dk önce");
    expect(tr).toContain("3 gün önce");
    expect(tr).toContain("data-demo-marker");
    const empty = await compare((l) => (
      <ActivityFeed {...L(l)} data={{ demo: true, items: [] }} now={NOW} />
    ));
    expect(empty.tr).toContain("Henüz etkinlik yok");
  });

  it("quick actions keep their links", async () => {
    const { tr } = await compare((l) => <QuickActions t={T[l]} />);
    expect(tr).toContain("Hızlı işlemler");
    for (const href of ["/content", "/products", "/staff", "/audit"])
      expect(tr).toContain(`href="${href}"`);
  });

  it("session card: every variant, Turkish times", async () => {
    for (const v of [
      {},
      { stepUpValidUntil: null },
      { mfaVerifiedAt: null },
      { idleExpiresAt: iso(2 * 1440) },
      { idleExpiresAt: iso(-3) },
    ] as Partial<StaffSessionResponse>[]) {
      session = makeSession(v);
      await compare((l) => <SessionCard {...L(l)} session={session} now={NOW} />);
    }
    session = makeSession();
    const { tr } = await compare((l) => <SessionCard {...L(l)} session={session} now={NOW} />);
    expect(tr).toContain("30 dk sonra");
    expect(tr).toContain("14:40 saatine kadar doğrulandı");
    expect(tr).toContain("Doğrulayıcı");
  });

  it("site status: every state; the BV domain stays", async () => {
    const sites = (l: AdminLocale) => {
      const d = demoData.demoDatasets(T[l]).DEMO_SITES;
      return {
        demo: true as const,
        items: [...d.items, { ...d.items[0]!, state: "maintenance" as const }],
      };
    };
    const { tr } = await compare((l) => <SiteStatusPanel {...L(l)} data={sites(l)} now={NOW} />);
    for (const text of ["Yayında", "Bakımda", "Hazırlanıyor", "Kurumsal site"])
      expect(tr).toContain(text);
    expect(tr).toContain("dreampetroleumbv.com");
    expect(tr).toContain("34 dk önce yayınlandı");
    expect(tr).toContain("henüz yayınlanmadı");
  });
});

describe("Review queue panel (TR)", () => {
  it("translates every state with the ML-12a/b terms", async () => {
    reads.set(REVIEW_QUEUE, { items: REVIEW_ITEMS, total: 12, canApprove: true });
    const full = await compare(panel);
    expect(full.tr).toContain("İncelemede: 12");
    expect(full.tr).toContain("Fixture product 1");
    expect(full.tr).toContain("PRD-1");
    expect(full.tr).not.toContain("Fixture product 6");
    reads.set(REVIEW_QUEUE, { items: [], total: 0, canApprove: true });
    expect((await compare(panel)).tr).toContain("İnceleme bekleyen kayıt yok");
    reads.set(REVIEW_QUEUE, FORBIDDEN);
    expect((await compare(panel)).tr).toContain("Ürün kataloğuna erişiminiz yok");
    reads.set(REVIEW_QUEUE, FAIL);
    expect((await compare(panel)).tr).toContain("İnceleme kuyruğu yüklenemedi");
    expect((await compare((l) => <ProductReviewSkeleton t={T[l]} />)).tr).toContain(
      "İnceleme kuyruğu yükleniyor",
    );
  });
});

describe("Sample data (TR)", () => {
  it("keeps the shape and the demo flag; only texts change", () => {
    const en = demoData.demoDatasets(T.en);
    const tr = demoData.demoDatasets(T.tr);
    const shape = (v: unknown): unknown =>
      JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "string" ? "" : x)));
    for (const name of ["DEMO_KPIS", "DEMO_ACTIVITY", "DEMO_SITES"] as const) {
      expect(tr[name].demo).toBe(true);
      expect(shape(tr[name])).toEqual(shape(en[name]));
    }
    expect(tr.DEMO_ACTIVITY.items.map((e) => e.actor)).toEqual(
      en.DEMO_ACTIVITY.items.map((e) => e.actor),
    );
    expect(tr.DEMO_KPIS.items.map((k) => k.id)).toEqual(en.DEMO_KPIS.items.map((k) => k.id));
    expect(demoData.siteLabels(T.tr)).toEqual({
      bv: "dreampetroleumbv.com",
      corporate: "Kurumsal site",
    });
    expect(TR_MESSAGES.dashboard.demo.people).toEqual(EN_MESSAGES.dashboard.demo.people);
  });

  it("marks sample data in the UI language (components/demo-badge.tsx, ML-12e)", async () => {
    const { DemoBadge } = await import("../components/ui");
    const tr = await render(() => <DemoBadge />, "tr");
    expect(tr).toContain(">Örnek veri<");
    expect(tr).toContain(
      'title="Tasarım prototipi için örnek veri. Hiçbir sisteme bağlı değildir."',
    );
    expect(tr).toContain("data-demo-marker");
    const en = await render(() => <DemoBadge />, "en");
    expect(en).toContain(">Sample data<");
  });

  it("writes the KPI change the Turkish way (+%4,2), English unchanged (+4.2%)", async () => {
    const { formatDelta } = await import("../lib/format");
    expect([4.2, -1, 0].map((n) => formatDelta(n, "tr"))).toEqual(["+%4,2", "−%1,0", "%0,0"]);
    expect([4.2, -1, 0].map((n) => formatDelta(n))).toEqual(["+4.2%", "−1.0%", "0.0%"]);
  });
});
