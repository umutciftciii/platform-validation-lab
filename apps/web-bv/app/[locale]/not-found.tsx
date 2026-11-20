import type { Metadata } from "next";

import { NotFoundView } from "@/components/not-found-view";
import { dictionary } from "@/lib/i18n";
import { pageLocale } from "@/lib/page-locale";

/** ML-6: the title in the page's language. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await pageLocale()).meta.notFound,
    robots: { index: false, follow: false },
  };
}

/** `notFound()` inside a page of a language (e.g. an unknown slug found at render time). */
export default async function NotFound() {
  return <NotFoundView locale={await pageLocale()} />;
}
