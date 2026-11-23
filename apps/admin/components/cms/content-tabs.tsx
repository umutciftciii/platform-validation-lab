import Link from "next/link";
import type { Translate } from "../../lib/i18n/types";
import { cx } from "../ui";

/** DP-020: Content has two lists per site: the site's pages and its news articles. */
export function ContentTabs({
  current,
  siteParam,
  t,
}: {
  current: "pages" | "news";
  siteParam: string;
  /** ML-12c: the UI language of the server page that renders the tabs. */
  t: Translate;
}) {
  const tabs = [
    { key: "pages", label: t("content.pages.tabs.pages"), href: `/content?site=${siteParam}` },
    { key: "news", label: t("content.pages.tabs.news"), href: `/content/news?site=${siteParam}` },
  ] as const;
  return (
    <nav aria-label={t("content.pages.tabs.label")} className="flex gap-1 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={cx(
            "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            tab.key === current
              ? "border-petrol text-petrol-strong"
              : "border-transparent text-ink-3 hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
