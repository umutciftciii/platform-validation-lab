import type { Metadata } from "next";

import ApplicationsShowcase from "@/components/ui/applications-showcase";
import CtlTechnology from "@/components/ui/ctl-technology";
import ProductGroupsShowcase from "@/components/ui/product-groups-showcase";
import ServicesShowcase from "@/components/ui/services-showcase";
import SiteFooter from "@/components/ui/site-footer";
import SiteNav from "@/components/ui/site-nav";
import SpatialDepthHero from "@/components/ui/spatial-depth-hero";

export const metadata: Metadata = {
  title: "ICCSYN hero with product groups",
  robots: { index: false, follow: false },
};

// The hero is unchanged and keeps its standard scroll length. The showcase is a
// normal full-screen section after it and never takes over page scrolling.
export default function IccsynHeroProductsDemoPage() {
  return (
    <>
      <SiteNav />
      <main>
        <SpatialDepthHero />
        <ProductGroupsShowcase />
        <ServicesShowcase />
        <CtlTechnology />
        <ApplicationsShowcase />
      </main>
      <SiteFooter />
    </>
  );
}
