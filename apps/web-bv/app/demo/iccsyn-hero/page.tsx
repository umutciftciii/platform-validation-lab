import type { Metadata } from "next";

import SpatialDepthHero from "@/components/ui/spatial-depth-hero";

export const metadata: Metadata = {
  title: "ICCSYN hero demo",
  robots: { index: false, follow: false },
};

export default function IccsynHeroDemoPage() {
  return (
    <main>
      <SpatialDepthHero />
      {/* Shows the hero handing the scroll back to the rest of a page. */}
      <section className="bg-ink px-6 py-32 text-center text-sm text-steel">
        End of the demo. The next homepage section would start here.
      </section>
    </main>
  );
}
