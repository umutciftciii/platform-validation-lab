/**
 * COM-3: what the corporate news pages need besides the CMS content, as pure functions.
 *
 *  - Pages of the list: 12 articles a page (as the live Blogs page), `?page=2` for the next ones.
 *    The first page has no `page` parameter (`?page=1` is not its address); a page past the last
 *    one, or anything that is not a plain number, is no page of the list (the site's 404). An
 *    empty list is page 1 with no article (the heading's empty state).
 *  - Dates: the article's first publication in the page's language, Istanbul time (the company's
 *    head office), day, month name and year.
 *
 * Pure (no Next.js, no `@/` imports) so `node --test` runs it as is.
 */
import type { RouteLocale } from "./locale-routing.ts";

export const NEWS_PAGE_SIZE = 12;

export interface NewsPage<T> {
  items: T[];
  /** 1-based. */
  page: number;
  pages: number;
}

/** The page `raw` (a `page` query value) of the list, or null when the list has no such page. */
export function newsPage<T>(
  articles: readonly T[],
  raw: string | string[] | undefined,
  size: number = NEWS_PAGE_SIZE,
): NewsPage<T> | null {
  const pages = Math.max(1, Math.ceil(articles.length / size));
  let page = 1;
  if (raw !== undefined) {
    if (typeof raw !== "string" || !/^[1-9][0-9]{0,3}$/.test(raw)) return null;
    page = Number(raw);
    // The first page's address has no parameter.
    if (page === 1 || page > pages) return null;
  }
  return { items: articles.slice((page - 1) * size, page * size), page, pages };
}

/** The list's address of a page in its language ("/en/news", "/en/news?page=2"). */
export function newsPageHref(listHref: string, page: number): string {
  return page <= 1 ? listHref : `${listHref}?page=${page}`;
}

const DATE_LOCALE: Record<RouteLocale, string> = { en: "en-GB", tr: "tr-TR" };

/** The date of an ISO instant in the page's language ("27 November 2026", "27 Kasım 2026"). */
export function formatNewsDate(locale: RouteLocale, iso: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  }).format(new Date(iso));
}
