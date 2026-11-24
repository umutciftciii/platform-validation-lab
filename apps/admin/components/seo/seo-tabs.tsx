import Link from "next/link";
import type { Translate } from "../../lib/i18n/types";
import { cx } from "../ui";

const TABS = [
  { id: "overview", href: "/seo" },
  // DP-211: redirect management of the BV site.
  { id: "redirects", href: "/seo/redirects" },
] as const;

/**
 * DP-211: the two parts of the SEO section (overview and redirects).
 * ML-12d: a shared server component; the page passes its `t` (labels `seo.tabs.*`).
 */
export function SeoTabs({
  current,
  t: tr,
}: {
  current: (typeof TABS)[number]["id"];
  t: Translate;
}) {
  return (
    <nav aria-label={tr("seo.tabs.label")} className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === current ? "page" : undefined}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
            t.id === current
              ? "border-petrol text-petrol-strong"
              : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {tr(`seo.tabs.${t.id}`)}
        </Link>
      ))}
    </nav>
  );
}
