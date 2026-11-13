// DP-U: dashboard widgets render server-side, sample data is always marked, real session data
// never is, and empty datasets fall back to their empty states.
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messageFor } from "../components/auth/login-form";
import { ActivityFeed } from "../components/dashboard/activity-feed";
import { KpiStrip } from "../components/dashboard/kpi-strip";
import { SessionCard } from "../components/dashboard/session-card";
import { SiteStatusPanel } from "../components/dashboard/site-status";
import { RingMotif } from "../components/icons";
import { Spinner } from "../components/ui";
import {
  ALL_DEMO_DATASETS,
  DEMO_ACTIVITY,
  DEMO_KPIS,
  DEMO_SITES,
  type ActivityEvent,
  type DemoDataset,
} from "../lib/demo-data";

const NOW = new Date("2026-11-11T12:00:00Z");
const MARKER = "data-demo-marker";

describe("sample data", () => {
  it("flags every dataset as demo", () => {
    for (const [name, dataset] of Object.entries(ALL_DEMO_DATASETS)) {
      expect(dataset.demo, name).toBe(true);
      expect(dataset.items.length, name).toBeGreaterThan(0);
    }
  });

  it("contains no e-mail addresses or URLs", () => {
    const text = JSON.stringify(ALL_DEMO_DATASETS);
    expect(text).not.toMatch(/@|https?:\/\//);
  });
});

describe("dashboard widgets", () => {
  it("KPI strip shows values and the sample-data marker", () => {
    const html = renderToStaticMarkup(<KpiStrip data={DEMO_KPIS} />);
    expect(html).toContain(MARKER);
    for (const kpi of DEMO_KPIS.items) expect(html).toContain(kpi.label);
    expect(html).toContain("+4.2%");
  });

  it("KPI strip labels every 12-week trace and states each delta in text", () => {
    const html = renderToStaticMarkup(<KpiStrip data={DEMO_KPIS} />);
    for (const kpi of DEMO_KPIS.items) expect(html).toContain(`${kpi.label}, 12-week trend`);
    expect(html).toContain("−8.0%");
  });

  it("brand ring motif and spinner are hidden from assistive technology", () => {
    expect(renderToStaticMarkup(<RingMotif />)).toMatch(/^<svg aria-hidden="true"/);
    expect(renderToStaticMarkup(<Spinner />)).toMatch(/^<svg aria-hidden="true"/);
  });

  it("activity feed and site status carry the marker", () => {
    expect(renderToStaticMarkup(<ActivityFeed data={DEMO_ACTIVITY} now={NOW} />)).toContain(MARKER);
    expect(renderToStaticMarkup(<SiteStatusPanel data={DEMO_SITES} now={NOW} />)).toContain(MARKER);
  });

  it("activity feed shows its empty state for an empty dataset", () => {
    const empty: DemoDataset<ActivityEvent> = { demo: true, items: [] };
    expect(renderToStaticMarkup(<ActivityFeed data={empty} now={NOW} />)).toContain(
      "No activity yet",
    );
  });

  it("session card shows the real session without the sample-data marker", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        now={NOW}
        session={{
          user: { id: randomUUID(), email: "staff@example.com", displayName: null },
          mfaVerifiedAt: null,
          stepUpValidUntil: null,
          idleExpiresAt: "2026-11-11T12:30:00.000Z",
          absoluteExpiresAt: "2026-11-11T20:00:00.000Z",
        }}
      />,
    );
    expect(html).not.toContain(MARKER);
    expect(html).toContain("Recovery code");
    expect(html).toContain("in 30 min");
  });
});

describe("sign-in error messages", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("uses the contract text for a known error code", async () => {
    const res = json(401, {
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "anything",
        requestId: randomUUID(),
        details: [],
      },
    });
    expect(await messageFor(res)).toEqual({
      code: "AUTH_INVALID_CREDENTIALS",
      text: "The e-mail address or password is incorrect.",
    });
  });

  it("says where to sign in when the API rejects the origin", async () => {
    const res = json(403, {
      error: { code: "AUTH_CSRF_REJECTED", message: "x", requestId: randomUUID(), details: [] },
    });
    expect((await messageFor(res)).text).toMatch(/not allowed from this address/);
  });

  it("explains rate limiting and hides unexpected bodies", async () => {
    expect((await messageFor(json(429, {}))).text).toMatch(/Too many attempts/);
    expect((await messageFor(json(500, { stack: "secret" }))).text).toMatch(/not available/);
  });
});
