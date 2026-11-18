import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomePage, HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { OrganizationJsonLd } from "@/components/seo/json-ld";
import { getPublishedHome } from "@/lib/cms-home";
import { noindexMetadata, pageMetadata } from "@/lib/seo";

// One API read per request for the metadata and the page.
const published = cache(getPublishedHome);

/**
 * The BV home page (CMS S2, DP-134): the published `bv.home` revision with the published
 * navigation and footer, read at request time. Not published: the unavailable state, with a 404
 * status where the response has not started yet; never content from code.
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const res = await published();
  if (!res.ok) return noindexMetadata("Dream Petroleum BV");
  const { title, seo } = res.data;
  // DP-207: indexable only under the site policy (production + DP_SEO_INDEXING=on), lib/seo.ts.
  return pageMetadata({ path: "/", title: seo.title ?? title, description: seo.description, noindex: seo.noindex });
}

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <PublishedHome />
    </Suspense>
  );
}

async function PublishedHome() {
  await connection();
  const res = await published();
  if (!res.ok) return <HomeUnavailable reason={res.reason} />;
  return (
    <>
      <OrganizationJsonLd />
      <HomePage view={res.data} />
    </>
  );
}
