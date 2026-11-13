import { cx } from "../ui";

/**
 * Jump links between the sections of a product page (master, listing, specifications, images).
 * Sticky under the top bar; on phones it scrolls sideways inside itself, never the page.
 */
export function SectionNav({
  items,
}: {
  items: readonly { id: string; label: string; count?: number }[];
}) {
  return (
    <nav
      aria-label="Product sections"
      className="sticky top-14 z-10 -mx-4 border-b border-line bg-bg px-4 py-2 sm:top-16 sm:mx-0 sm:rounded-xl sm:border sm:px-2"
    >
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              className={cx(
                "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
                  {item.count}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
