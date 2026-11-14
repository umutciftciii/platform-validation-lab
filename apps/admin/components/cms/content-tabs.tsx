import Link from "next/link";
import { cx } from "../ui";

/** DP-020: Content has two lists per site: the site's pages and its news articles. */
export function ContentTabs({
  current,
  siteParam,
}: {
  current: "pages" | "news";
  siteParam: string;
}) {
  const tabs = [
    { key: "pages", label: "Pages", href: `/content?site=${siteParam}` },
    { key: "news", label: "News", href: `/content/news?site=${siteParam}` },
  ] as const;
  return (
    <nav aria-label="Content type" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cx(
            "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            t.key === current
              ? "border-petrol text-petrol-strong"
              : "border-transparent text-ink-3 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
