import type { Metadata } from "next";

import SpatialDepthHero from "@/components/ui/spatial-depth-hero";

export const metadata: Metadata = {
  title: "ICCSYN hero demo, compact scroll",
  robots: { index: false, follow: false },
};

// Scroll-length alternative for review. Animation and layout match the main demo.
export default function IccsynHeroCompactDemoPage() {
  return (
    <main>
      <SpatialDepthHero scrollLength="compact" />
      <section className="bg-ink px-6 py-32 text-center text-sm text-steel">
        End of the demo. The next homepage section would start here.
      </section>
    </main>
  );
}
