import Link from "next/link";
import type { Translate } from "../../lib/i18n/types";
import { withSeoSite } from "../../lib/seo-site";
import { cx } from "../ui";

const TABS = [
  { id: "overview", href: "/seo" },
  // DP-211: redirect management (COM-1: of the chosen site).
  { id: "redirects", href: "/seo/redirects" },
] as const;

/**
 * DP-211: the two parts of the SEO section (overview and redirects).
 * ML-12d: a shared server component; the page passes its `t` (labels `seo.tabs.*`).
 */
export function SeoTabs({
  current,
  t: tr,
  siteKey = "BV",
}: {
  current: (typeof TABS)[number]["id"];
  t: Translate;
  /** COM-1: the site shown; the tabs keep it (BV adds no parameter). */
  siteKey?: "BV" | "CORPORATE";
}) {
  return (
    <nav aria-label={tr("seo.tabs.label")} className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={withSeoSite(t.href, siteKey)}
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
