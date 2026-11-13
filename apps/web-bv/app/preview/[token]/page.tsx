import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { HomePage, HomeSkeleton, HomeUnavailable } from "@/components/home/home-page";
import { TemplatePage } from "@/components/template/template-page";
import { getPreview } from "@/lib/cms-home";

const preview = cache(getPreview);

/**
 * CMS S2/S3 preview (ADR-020 D6): the current draft of the page a signed link names (the home
 * page, a fragment around it, or a template page), valid for 15
 * minutes and only on this site. Never indexed, never cached (see next.config headers).
 */
export const metadata: Metadata = {
  title: "Preview · Dream Petroleum BV",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PreviewPage({ params }: PageProps<"/preview/[token]">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: PageProps<"/preview/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const res = await preview(token);
  if (!res.ok) return <HomeUnavailable reason={res.reason} />;
  return res.data.kind === "template" ? (
    <TemplatePage view={res.data} />
  ) : (
    <HomePage view={res.data} />
  );
}
