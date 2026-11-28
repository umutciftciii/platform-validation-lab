/**
 * CRM-3 (ADR-032 D11): the tabs of a 360° view (company, person). Each tab is a link with its own
 * address (`?tab=`), so the page reads only the data of the open tab and the browser's back
 * button works. Scrolls sideways on narrow screens.
 */
import Link from "next/link";
import { cx } from "../ui";

export interface ViewTab<K extends string> {
  key: K;
  label: string;
  /** A count shown next to the label (only when known without an extra read). */
  count?: number | undefined;
}

export function ViewTabs<K extends string>({
  tabs,
  active,
  href,
  label,
}: {
  tabs: readonly ViewTab<K>[];
  active: K;
  href: (key: K) => string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-4 border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={href(tab.key)}
                scroll={false}
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                  selected
                    ? "border-petrol text-ink"
                    : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span className="tabular-nums rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The tab named in the address, or the first one. */
export function readTab<K extends string>(
  value: string | string[] | undefined,
  keys: readonly K[],
): K {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && (keys as readonly string[]).includes(v) ? (v as K) : (keys[0] as K);
}
