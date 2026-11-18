import Link from "next/link";
import { cx } from "../ui";

const TABS = [
  { id: "overview", href: "/seo", label: "Overview" },
  // DP-211: redirect management of the BV site.
  { id: "redirects", href: "/seo/redirects", label: "Redirects" },
] as const;

/** DP-211: the two parts of the SEO section (overview and redirects). */
export function SeoTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="SEO" className="flex gap-1 border-b border-line">
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
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
