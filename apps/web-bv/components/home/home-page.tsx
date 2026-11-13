import ApplicationsShowcase from "@/components/ui/applications-showcase";
import CtlTechnology from "@/components/ui/ctl-technology";
import ProductGroupsShowcase from "@/components/ui/product-groups-showcase";
import ServicesShowcase from "@/components/ui/services-showcase";
import SiteFooter from "@/components/ui/site-footer";
import SiteNav from "@/components/ui/site-nav";
import SpatialDepthHero from "@/components/ui/spatial-depth-hero";
import type { CmsPageView } from "@/lib/cms-home";

/**
 * The BV home page (CMS S2): the same components, order and markup as the former
 * /demo/iccsyn-hero-products, filled from one CMS view. A fragment that is not published
 * (navigation, footer) is left out; nothing is filled from code.
 */
export function HomePage({ view }: { view: CmsPageView }) {
  const { home } = view;
  return (
    <>
      {view.preview ? <PreviewBanner /> : null}
      {view.nav ? <SiteNav content={view.nav} /> : null}
      <main>
        <SpatialDepthHero content={home.hero} />
        <ProductGroupsShowcase {...home.productGroups} />
        <ServicesShowcase {...home.services} />
        <CtlTechnology {...home.ctl} />
        <ApplicationsShowcase {...home.applications} />
      </main>
      {view.footer ? <SiteFooter content={view.footer} /> : null}
    </>
  );
}

/** Fixed at the bottom so it never moves the page's own layout (preview only). */
function PreviewBanner() {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-amber px-4 py-2 text-center text-sm font-medium text-ink"
    >
      Preview of a draft. Not published, not indexed; this link expires after 15 minutes.
    </div>
  );
}

/** Shown when the home page is not published or cannot be read: never the old content. */
export function HomeUnavailable({ reason }: { reason: "not_found" | "unavailable" }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-ink px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">Dream Petroleum BV</p>
      <h1 className="mt-4 text-[clamp(1.75rem,4vw,2.75rem)] font-medium text-glass [font-stretch:115%]">
        {reason === "not_found" ? "This page is not available" : "This page cannot be shown right now"}
      </h1>
      <p className="mt-3 max-w-[48ch] text-steel">
        {reason === "not_found"
          ? "It is not published at the moment."
          : "Please try again in a moment."}
      </p>
    </main>
  );
}

export function HomeSkeleton() {
  return <main aria-busy="true" className="min-h-dvh bg-ink" />;
}
