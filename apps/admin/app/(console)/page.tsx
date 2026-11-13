import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityFeed } from "../../components/dashboard/activity-feed";
import { KpiStrip } from "../../components/dashboard/kpi-strip";
import { QuickActions } from "../../components/dashboard/quick-actions";
import {
  ProductReviewPanel,
  ProductReviewSkeleton,
} from "../../components/dashboard/product-review";
import { SessionCard } from "../../components/dashboard/session-card";
import { SiteStatusPanel } from "../../components/dashboard/site-status";
import { Icon, RingMotif } from "../../components/icons";
import { DEMO_ACTIVITY, DEMO_KPIS, DEMO_SITES } from "../../lib/demo-data";
import { formatLongDate, greeting } from "../../lib/format";
import { requireStaffSession } from "../../lib/server-session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  // The layout checks too, but a layout is not re-rendered on client navigation.
  const session = await requireStaffSession();
  const now = new Date();
  const firstName =
    session.user.displayName?.split(/\s+/)[0] ?? session.user.email.split("@")[0] ?? "";

  return (
    <div className="space-y-5 sm:space-y-8">
      {/* Masthead: the brand navy and ring motif of the sign-in page, so the console opens in the
          Dream Petroleum identity rather than a generic white page. */}
      <header className="on-rail relative isolate overflow-hidden rounded-2xl bg-masthead px-5 py-5 text-rail-ink shadow-panel ring-1 ring-inset ring-white/5 sm:px-8 sm:py-8">
        <RingMotif
          size={300}
          className="pointer-events-none absolute -right-4 -top-4 -z-10 hidden sm:block"
        />
        <RingMotif
          size={150}
          rings={4}
          className="pointer-events-none absolute -right-2 -top-2 -z-10 sm:hidden"
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="type-eyebrow flex items-center gap-2 text-rail-ink-dim">
              <span className="h-px w-4 bg-brand" aria-hidden="true" />
              {formatLongDate(now)}
            </p>
            <h1 className="type-display mt-2 text-[1.625rem] font-semibold text-white sm:text-[2.5rem]">
              {greeting(now)}, {firstName}
            </h1>
            <p className="mt-1.5 hidden max-w-[60ch] text-sm text-rail-ink-dim sm:block">
              Pages, product data sheets and staff access for both Dream Petroleum sites.
            </p>
          </div>
          <Link
            href="/content"
            className="inline-flex h-10 w-fit shrink-0 select-none items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[#0b1b2e] shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-[background-color,transform] duration-150 ease-out-soft hover:bg-[#e3ecf3] active:translate-y-px"
          >
            <Icon name="plus" size={17} />
            Write a page
          </Link>
        </div>
      </header>

      <div
        role="note"
        className="demo-hatch flex items-start gap-3 rounded-xl border border-amber/35 bg-amber-soft/70 px-4 py-2.5 text-[0.8125rem] leading-snug text-amber-ink sm:py-3 sm:text-sm"
      >
        <Icon name="alert" size={17} className="mt-px shrink-0" />
        <p>
          <span className="font-semibold">Sample data.</span> Figures, activity and site status on
          this overview are illustrations, not connected to any system. The review queue and your
          session details are real.
        </p>
      </div>

      <KpiStrip data={DEMO_KPIS} />

      <QuickActions />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Suspense fallback={<ProductReviewSkeleton />}>
            <ProductReviewPanel now={now} />
          </Suspense>
          <ActivityFeed data={DEMO_ACTIVITY} now={now} />
        </div>
        <div className="space-y-6">
          <SessionCard session={session} now={now} />
          <SiteStatusPanel data={DEMO_SITES} now={now} />
        </div>
      </div>
    </div>
  );
}
