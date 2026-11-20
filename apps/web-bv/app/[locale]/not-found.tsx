import type { Metadata } from "next";

import { NotFoundView } from "@/components/not-found-view";
import { pageLocale } from "@/lib/page-locale";

export const metadata: Metadata = {
  title: "Page not found | Dream Petroleum BV",
  robots: { index: false, follow: false },
};

/** `notFound()` inside a page of a language (e.g. an unknown slug found at render time). */
export default async function NotFound() {
  return <NotFoundView locale={await pageLocale()} />;
}
