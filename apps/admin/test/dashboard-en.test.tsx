// ML-12e (DP-243) EN regression of the Overview (dashboard): the overview page (date, greeting per
// time of day, with and without a display name, masthead, sample-data note, metadata), the KPI strip
// (every tone and delta direction), recent activity (every event kind, relative times, empty), quick
// actions, the review queue panel (full, more than five, empty, no catalogue access, load error,
// skeleton), the session card (every variant), the site status panel (every state), the sample
// data itself, the [section] placeholder page, the console error boundary and the loading screen.
// Every render goes through support/en-baseline-render: it is compared with the HTML recorded on
// private main 10dec17 (before ML-12e) in fixtures/catalog-en/dashboard-en.json.gz (record with
// ML12E_RECORD_EN=1, this file only).
import type { StaffSessionResponse } from "@dream/contracts";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../lib/i18n/translate";
import { renderToStaticMarkup } from "./support/en-baseline-render";

const REVIEW_QUEUE = "/api/v1/admin/catalog/review-queue";
const reads = new Map<string, unknown>();
const FAIL = Symbol("fail");
const FORBIDDEN = Symbol("forbidden");
let session: StaffSessionResponse;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
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
const OverviewPage = overviewModule.default;
const { default: Loading } = await import("../app/(console)/loading");
const { default: ConsoleError } = await import("../app/(console)/error");
const sectionModule = await import("../app/(console)/[section]/page");
const { ActivityFeed } = await import("../components/dashboard/activity-feed");
const { KpiStrip } = await import("../components/dashboard/kpi-strip");
const { ProductReviewPanel, ProductReviewSkeleton } =
  await import("../components/dashboard/product-review");
const { QuickActions } = await import("../components/dashboard/quick-actions");
const { SessionCard } = await import("../components/dashboard/session-card");
const { SiteStatusPanel } = await import("../components/dashboard/site-status");
const demoData = await import("../lib/demo-data");

// ML-12e Aşama 2: the widgets take the translator and language; the sample texts are resolved
// from the dictionary (the same English values and shape as before).
const EN = createTranslator("en");
const L = { t: EN, locale: "en" } as const;
const demo = { ...demoData.demoDatasets(EN), SITE_LABELS: demoData.siteLabels(EN) };

type Kpi = import("../lib/demo-data").Kpi;
type ActivityEvent = import("../lib/demo-data").ActivityEvent;
type SiteStatus = import("../lib/demo-data").SiteStatus;

// Europe/Amsterdam is UTC+1 on these dates.
const MORNING = new Date("2026-11-24T08:05:00.000Z"); // 09:05
const AFTERNOON = new Date("2026-11-24T13:30:00.000Z"); // 14:30
const EVENING = new Date("2026-11-24T19:45:00.000Z"); // 20:45
const NOW = AFTERNOON;
const iso = (base: Date, minutes: number) =>
  new Date(base.getTime() + minutes * 60_000).toISOString();

const USER_ID = "0190f2a1-0000-7000-8000-000000000901";
const makeSession = (over: Partial<StaffSessionResponse> = {}): StaffSessionResponse => ({
  user: { id: USER_ID, email: "sanne.devries@fixture.invalid", displayName: "Sanne de Vries" },
  mfaVerifiedAt: iso(NOW, -60),
  stepUpValidUntil: iso(NOW, 10),
  idleExpiresAt: iso(NOW, 30),
  absoluteExpiresAt: iso(NOW, 6 * 60 + 30),
  ...over,
});

const reviewItem = (n: number, over: Record<string, unknown> = {}) => ({
  productId: `0190f2a1-0000-7000-8000-0000000003${String(n).padStart(2, "0")}`,
  code: `PRD-${n}`,
  name: `Fixture product ${n}`,
  version: n,
  submittedAt: iso(NOW, -n * 300),
  submittedBy: { id: USER_ID, name: "Jonas Peters" },
  comment: null,
  blockingCount: 0,
  warningCount: 0,
  canReview: true,
  reviewBlockedReason: null,
  ...over,
});

/** Every decision state of a row: ready, blocking, each blocked reason, waiting, no submitter. */
const REVIEW_ITEMS = [
  reviewItem(1, { comment: "Ready for review.", warningCount: 2 }),
  reviewItem(2, { blockingCount: 3, canReview: false }),
  reviewItem(3, { canReview: false, reviewBlockedReason: "own_change" }),
  reviewItem(4, { canReview: false, reviewBlockedReason: "no_permission", submittedBy: null }),
  reviewItem(5, { canReview: false, reviewBlockedReason: "not_in_review" }),
  reviewItem(6, { canReview: false, reviewBlockedReason: "archived" }),
  reviewItem(7, { canReview: false, reviewBlockedReason: null, submittedAt: iso(NOW, -4 * 1440) }),
];

const html = (node: ReactElement) => renderToStaticMarkup(node);
const overview = async () => html((await OverviewPage()) as ReactElement);
const reviewPanel = async (now = NOW) => html((await ProductReviewPanel({ now })) as ReactElement);
const section = (slug: string) => ({ params: Promise.resolve({ section: slug }) }) as never;

beforeEach(() => {
  reads.clear();
  session = makeSession();
});
afterEach(() => {
  vi.useRealTimers();
});

// --- Overview page ----------------------------------------------------------------------------------

describe("Overview page (EN)", () => {
  it("has its metadata title", async () => {
    expect(html(<pre>{JSON.stringify(await overviewModule.generateMetadata())}</pre>)).toContain(
      "Overview",
    );
  });

  it("greets in the morning, afternoon and evening by first name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const at of [MORNING, AFTERNOON, EVENING]) {
      vi.setSystemTime(at);
      session = makeSession();
      await overview();
    }
    vi.setSystemTime(MORNING);
    expect(await overview()).toContain("Good morning, Sanne");
    vi.setSystemTime(EVENING);
    expect(await overview()).toContain("Good evening, Sanne");
  });

  it("falls back to the e-mail name without a display name, and shows a recovery-code session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    session = makeSession({
      user: { id: USER_ID, email: "jonas@fixture.invalid", displayName: null },
      mfaVerifiedAt: null,
      stepUpValidUntil: null,
    });
    expect(await overview()).toContain("jonas");
    // A single-word display name and an owner session.
    session = makeSession({
      user: { id: USER_ID, email: "owner@fixture.invalid", displayName: "Mehmet" },
      isSystemOwner: true,
    });
    await overview();
  });
});

// --- KPI strip --------------------------------------------------------------------------------------

describe("KPI strip (EN)", () => {
  it("renders the sample KPIs", () => {
    expect(html(<KpiStrip {...L} data={demo.DEMO_KPIS} />)).toContain("Last 30 days");
  });

  it("renders every tone and delta direction", () => {
    const base = demo.DEMO_KPIS.items[0]!;
    const k = (id: string, over: Partial<Kpi>): Kpi => ({ ...base, id, ...over });
    const items = [
      k("up-good", { deltaPercent: 12.5, higherIsBetter: true, value: 1234567 }),
      k("up-bad", { deltaPercent: 3, higherIsBetter: false, tone: "attention" }),
      k("down-good", { deltaPercent: -4.44, higherIsBetter: false }),
      k("down-bad", { deltaPercent: -0.05, higherIsBetter: true, tone: "attention" }),
      k("flat", { deltaPercent: 0, value: 0 }),
    ];
    html(<KpiStrip {...L} data={{ demo: true, items }} />);
    // Not sample data (no marker) and no readings at all.
    html(<KpiStrip {...L} data={{ demo: false, items: items.slice(0, 2) } as never} />);
    html(<KpiStrip {...L} data={{ demo: true, items: [] }} />);
  });
});

// --- Recent activity --------------------------------------------------------------------------------

describe("Recent activity (EN)", () => {
  it("renders the sample events", () => {
    expect(html(<ActivityFeed {...L} data={demo.DEMO_ACTIVITY} now={NOW} />)).toContain(
      "Recent activity",
    );
  });

  it("renders every event kind and relative time", () => {
    const e = (id: string, kind: ActivityEvent["kind"], minutesAgo: number): ActivityEvent => ({
      id,
      actor: "Lotte Bakker",
      kind,
      text: `did ${kind}`,
      target: `Target ${id}`,
      minutesAgo,
    });
    const items = [
      e("a", "publish", 0),
      e("b", "edit", 1),
      e("c", "access", 59),
      e("d", "security", 60),
      e("e", "publish", 23 * 60),
      e("f", "edit", 24 * 60),
      e("g", "access", 3 * 24 * 60),
      e("h", "security", -15),
    ];
    html(<ActivityFeed {...L} data={{ demo: true, items }} now={NOW} />);
  });

  it("shows its empty state", () => {
    expect(html(<ActivityFeed {...L} data={{ demo: true, items: [] }} now={NOW} />)).toContain(
      "No activity yet",
    );
  });
});

// --- Quick actions ----------------------------------------------------------------------------------

describe("Quick actions (EN)", () => {
  it("renders every action (the same for every role)", () => {
    expect(html(<QuickActions t={EN} />)).toContain("Invite a colleague");
  });
});

// --- Review queue panel -----------------------------------------------------------------------------

describe("Review queue panel (EN)", () => {
  it("lists a short queue with every decision state", async () => {
    reads.set(REVIEW_QUEUE, { items: REVIEW_ITEMS.slice(0, 4), total: 4, canApprove: true });
    expect(await reviewPanel()).toContain("Open queue");
  });

  it("shows the first five of a longer queue", async () => {
    reads.set(REVIEW_QUEUE, { items: REVIEW_ITEMS, total: 12, canApprove: false });
    expect(await reviewPanel()).toContain("12 in review");
  });

  it("shows a single item", async () => {
    reads.set(REVIEW_QUEUE, { items: REVIEW_ITEMS.slice(0, 1), total: 1, canApprove: true });
    await reviewPanel();
  });

  it("shows the empty queue", async () => {
    reads.set(REVIEW_QUEUE, { items: [], total: 0, canApprove: true });
    expect(await reviewPanel()).toContain("Nothing waiting for review");
  });

  it("shows no catalogue access, a load error and a missing endpoint", async () => {
    reads.set(REVIEW_QUEUE, FORBIDDEN);
    expect(await reviewPanel()).toContain("No access to the product catalogue");
    reads.set(REVIEW_QUEUE, FAIL);
    expect(await reviewPanel()).toContain("The review queue could not be loaded");
    reads.delete(REVIEW_QUEUE);
    await reviewPanel();
  });

  it("shows its skeleton", () => {
    expect(html(<ProductReviewSkeleton t={EN} />)).toContain("Loading the review queue");
  });
});

// --- Session card -----------------------------------------------------------------------------------

describe("Session card (EN)", () => {
  it("renders every variant", () => {
    const variants: Partial<StaffSessionResponse>[] = [
      {}, // authenticator, step-up still valid, idle in 30 min
      { stepUpValidUntil: null }, // no step-up yet
      { stepUpValidUntil: iso(NOW, -5) }, // step-up expired
      { stepUpValidUntil: NOW.toISOString() }, // step-up ending right now
      { mfaVerifiedAt: null }, // recovery code
      { mfaVerifiedAt: null, stepUpValidUntil: null },
      { idleExpiresAt: iso(NOW, 0.5) }, // under a minute
      { idleExpiresAt: iso(NOW, 2 * 60) }, // hours
      { idleExpiresAt: iso(NOW, 2 * 1440), absoluteExpiresAt: iso(NOW, 2 * 1440) }, // days
      { idleExpiresAt: iso(NOW, -3) }, // already past
      { absoluteExpiresAt: "2026-11-24T23:30:00.000Z" }, // after midnight local time
    ];
    for (const v of variants) html(<SessionCard {...L} session={makeSession(v)} now={NOW} />);
  });
});

// --- Site status ------------------------------------------------------------------------------------

describe("Site status (EN)", () => {
  it("renders the sample sites", () => {
    expect(html(<SiteStatusPanel {...L} data={demo.DEMO_SITES} now={NOW} />)).toContain(
      "In preparation",
    );
  });

  it("renders every state and publication time", () => {
    const s = (over: Partial<SiteStatus>): SiteStatus => ({
      key: "bv",
      name: demo.SITE_LABELS.bv,
      state: "live",
      lastPublishedMinutesAgo: 5,
      pages: 1,
      drafts: 0,
      ...over,
    });
    const items = [
      s({ state: "live", lastPublishedMinutesAgo: 0 }),
      s({ state: "maintenance", lastPublishedMinutesAgo: 3 * 60, pages: 1200, drafts: 1 }),
      s({ key: "corporate", name: demo.SITE_LABELS.corporate, state: "preparing" }),
      s({ state: "live", lastPublishedMinutesAgo: 1440 }),
      s({ state: "preparing", lastPublishedMinutesAgo: null, pages: 0, drafts: 0 }),
    ];
    html(<SiteStatusPanel {...L} data={{ demo: true, items }} now={NOW} />);
    html(<SiteStatusPanel {...L} data={{ demo: true, items: [] }} now={NOW} />);
  });
});

// --- Sample data (dashboard UI text, recorded as plain values) --------------------------------------

describe("Sample data (EN)", () => {
  it("records every sample dataset and site label", () => {
    html(<pre>{JSON.stringify(demoData.demoDatasets(EN))}</pre>);
    html(<pre>{JSON.stringify(demo.SITE_LABELS)}</pre>);
  });
});

// --- Placeholder section, error boundary, loading ---------------------------------------------------

describe("Console placeholders (EN)", () => {
  it("renders the placeholder page of every module not built yet, and its titles", async () => {
    for (const slug of ["sites", "audit", "settings"]) {
      html((await sectionModule.default(section(slug))) as ReactElement);
      html(<pre>{JSON.stringify(await sectionModule.generateMetadata(section(slug)))}</pre>);
    }
    html(<pre>{JSON.stringify(await sectionModule.generateMetadata(section("nope")))}</pre>);
    await expect(sectionModule.default(section("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(sectionModule.default(section("content"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the error boundary with and without a reference", () => {
    html(
      <ConsoleError error={Object.assign(new Error("x"), { digest: "123456" })} reset={() => {}} />,
    );
    html(<ConsoleError error={new Error("x")} reset={() => {}} />);
  });

  it("renders the loading screen", async () => {
    html((await Loading()) as ReactElement);
  });
});
