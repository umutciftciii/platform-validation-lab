import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomePage, HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { getPublishedHome } from "@/lib/cms-home";

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
  if (!res.ok) return { title: "Dream Petroleum BV", robots: { index: false, follow: false } };
  const { title, seo } = res.data;
  return {
    title: seo.title ?? title,
    ...(seo.description ? { description: seo.description } : {}),
    // The whole site stays out of search engines until launch (root layout); noindex per page.
    robots: { index: false, follow: false },
  };
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
  return <HomePage view={res.data} />;
}
