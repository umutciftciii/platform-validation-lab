import type { Metadata } from "next";

import SiteNav from "@/components/ui/site-nav";
import SpatialDepthHero from "@/components/ui/spatial-depth-hero";

export const metadata: Metadata = {
  title: "ICCSYN hero demo with top navigation",
  robots: { index: false, follow: false },
};

// The hero is unchanged: same component and the same standard 240svh scroll as
// /demo/iccsyn-hero. Only the navigation is added, and only on this route.
export default function IccsynHeroNavDemoPage() {
  return (
    <>
      <SiteNav />
      <main>
        <SpatialDepthHero />
        <section className="bg-ink px-6 py-32 text-center text-sm text-steel">
          End of the demo. The next homepage section would start here.
        </section>
      </main>
    </>
  );
}
