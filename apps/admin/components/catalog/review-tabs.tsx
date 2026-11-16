"use client";

/**
 * The company review page's tabs (DP-189): Content Review, Missing & Verification, Sources and
 * History. Same behaviour as the product page's tabs (DP-187):
 *
 * - every panel is rendered on the server and stays mounted; an inactive panel is only hidden,
 *   so a comment typed in the decision form survives a tab change;
 * - the active tab is in the URL (`?tab=`, replaced, not pushed), so a reload or a shared link
 *   opens the same tab; `#section` links open the tab that holds the section;
 * - arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  REVIEW_TABS,
  reviewHref,
  reviewTabForHash,
  reviewTabLabel,
  type ReviewTabId,
} from "../../lib/review-tabs";
import { cx } from "../ui";

interface TabsState {
  active: ReviewTabId;
  select: (tab: ReviewTabId, section?: string) => void;
  proposalId: string;
  site: string | undefined;
}

const TabsContext = createContext<TabsState | null>(null);

const tabDomId = (base: string, tab: ReviewTabId) => `${base}-tab-${tab}`;
const panelDomId = (tab: ReviewTabId) => `review-tab-${tab}`;

export interface ReviewTabBadge {
  count?: number;
  /** A short warning on the tab (e.g. conflicts), read out with the label. */
  alert?: string;
}

export function ReviewTabs({
  proposalId,
  site,
  initialTab,
  badges,
  children,
}: {
  proposalId: string;
  site: string | undefined;
  initialTab: ReviewTabId;
  badges: Partial<Record<ReviewTabId, ReviewTabBadge>>;
  children: ReactNode;
}) {
  const [active, setActive] = useState<ReviewTabId>(initialTab);
  const [lastInitial, setLastInitial] = useState(initialTab);
  if (initialTab !== lastInitial) {
    setLastInitial(initialTab);
    setActive(initialTab);
  }
  const pendingSection = useRef<string | null>(null);
  // Bumped on every selection, so a link to a section of the active tab still scrolls to it.
  const [jump, setJump] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const base = useId();

  const select = useCallback(
    (tab: ReviewTabId, section?: string) => {
      pendingSection.current = section ?? null;
      setActive(tab);
      setJump((n) => n + 1);
      window.history.replaceState(null, "", reviewHref(proposalId, site, tab));
    },
    [proposalId, site],
  );

  // After a tab change: scroll to the asked-for section, else back to the tab bar if the page
  // was scrolled past it; keep the active tab visible inside the scrolling tab bar (phones).
  useEffect(() => {
    const section = pendingSection.current;
    pendingSection.current = null;
    if (section) {
      const el = document.getElementById(section);
      if (el instanceof HTMLDetailsElement) el.open = true;
      el?.scrollIntoView({ block: "start" });
    } else if (topRef.current && topRef.current.getBoundingClientRect().top < 0) {
      topRef.current.scrollIntoView({ block: "start" });
    }
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, jump]);

  // `#section` links (the former one-page layout, bookmarks): open the tab holding the section.
  useEffect(() => {
    const open = () => {
      const tab = reviewTabForHash(window.location.hash);
      if (tab) select(tab, window.location.hash.slice(1));
    };
    const frame = window.requestAnimationFrame(open);
    window.addEventListener("hashchange", open);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", open);
    };
  }, [select]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = REVIEW_TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % REVIEW_TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + REVIEW_TABS.length) % REVIEW_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = REVIEW_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = REVIEW_TABS[next]!.id;
    select(tab);
    document.getElementById(tabDomId(base, tab))?.focus();
  }

  const state = useMemo<TabsState>(
    () => ({ active, select, proposalId, site }),
    [active, select, proposalId, site],
  );

  return (
    <TabsContext.Provider value={state}>
      <div ref={topRef} className="scroll-mt-32" />
      <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-bg px-4 sm:top-16 sm:mx-0 sm:px-0">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Review sections"
          onKeyDown={onKeyDown}
          className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {REVIEW_TABS.map((t) => {
            const selected = t.id === active;
            const badge = badges[t.id];
            return (
              <button
                key={t.id}
                id={tabDomId(base, t.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelDomId(t.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(t.id)}
                className={cx(
                  "relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol/40 focus-visible:ring-inset",
                  selected
                    ? "border-petrol text-ink"
                    : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink",
                )}
              >
                {t.label}
                {badge?.count !== undefined ? (
                  <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-3 ring-1 ring-line">
                    {badge.count}
                  </span>
                ) : null}
                {badge?.alert ? (
                  <span
                    className="tabular rounded-full bg-danger-soft px-1.5 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/25"
                    title={badge.alert}
                  >
                    !<span className="sr-only">, {badge.alert}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="pt-1">{children}</div>
    </TabsContext.Provider>
  );
}

/** One tab's content; stays mounted (hidden) while another tab is active. */
export function ReviewTabPanel({ tab, children }: { tab: ReviewTabId; children: ReactNode }) {
  const tabs = useContext(TabsContext);
  const hidden = tabs ? tabs.active !== tab : false;
  return (
    <div
      id={panelDomId(tab)}
      role="tabpanel"
      aria-label={reviewTabLabel(tab)}
      hidden={hidden}
      className="space-y-6 sm:space-y-8"
    >
      {children}
    </div>
  );
}

/** A link to a tab (and a section in it) of this proposal page. */
export function ReviewTabLink({
  tab,
  section,
  className,
  children,
}: {
  tab: ReviewTabId;
  section?: string;
  className?: string;
  children: ReactNode;
}) {
  const tabs = useContext(TabsContext);
  if (!tabs) return <span className={className}>{children}</span>;
  const href = `${reviewHref(tabs.proposalId, tabs.site, tab)}${section ? `#${section}` : ""}`;
  return (
    <a
      href={href}
      className={className}
      onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        tabs.select(tab, section);
      }}
    >
      {children}
    </a>
  );
}
