"use client";

/**
 * The product page's tabs (DP-187): Content, Technical, Media & Documents and Publication.
 *
 * - Every panel is rendered on the server and stays mounted; an inactive panel is only hidden,
 *   so what was typed in it survives a tab change.
 * - A save elsewhere bumps the product version and refreshes the page. `KeepUnsaved` then keeps
 *   a form that has unsaved changes instead of remounting it (it gets the new props, so it saves
 *   against the new version); a clean form remounts as before.
 * - Tabs with unsaved changes carry a dot; leaving the page (link, reload, site switch) with
 *   unsaved changes asks first.
 * - The active tab is in the URL (`?tab=`, replaced, not pushed); old `#section` links open the
 *   tab that holds the section.
 */
import type { CatalogSite } from "@dream/contracts";
import Link from "next/link";
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
  PRODUCT_TABS,
  productHref,
  productTabLabel,
  tabForHash,
  type ProductTabId,
} from "../../lib/product-tabs";
import { cx } from "../ui";
import { NoticeScope, type NoticeOrigin } from "./notices";
import { SiteSwitcher } from "./parts";

const LEAVE_TEXT = "You have unsaved changes on this product. Leave the page and discard them?";

interface TabsState {
  active: ProductTabId;
  select: (tab: ProductTabId, section?: string) => void;
  productId: string;
  siteParam: string;
  setUnsaved: (id: string, tab: ProductTabId | null, unsaved: boolean) => void;
}

const TabsContext = createContext<TabsState | null>(null);
const PanelContext = createContext<ProductTabId | null>(null);
const KeepContext = createContext<((unsaved: boolean) => void) | null>(null);

const tabDomId = (base: string, tab: ProductTabId) => `${base}-tab-${tab}`;
const panelDomId = (tab: ProductTabId) => `product-tab-${tab}`;

export interface TabBadge {
  count?: number;
  /** A short warning on the tab (e.g. publication blockers), read out with the label. */
  alert?: string;
}

export function ProductTabs({
  productId,
  siteParam,
  initialTab,
  badges,
  children,
}: {
  productId: string;
  siteParam: string;
  initialTab: ProductTabId;
  badges: Partial<Record<ProductTabId, TabBadge>>;
  children: ReactNode;
}) {
  const [active, setActive] = useState<ProductTabId>(initialTab);
  // A navigation to `?tab=…` (e.g. a fix link to another site) re-renders with a new prop.
  const [lastInitial, setLastInitial] = useState(initialTab);
  if (initialTab !== lastInitial) {
    setLastInitial(initialTab);
    setActive(initialTab);
  }
  const [unsaved, setUnsavedMap] = useState<Readonly<Record<string, ProductTabId | null>>>({});
  const pendingSection = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const base = useId();
  const anyUnsaved = Object.keys(unsaved).length > 0;

  const setUnsaved = useCallback((id: string, tab: ProductTabId | null, value: boolean) => {
    setUnsavedMap((map) => {
      if (value === id in map) return map;
      const next = { ...map };
      if (value) next[id] = tab;
      else delete next[id];
      return next;
    });
  }, []);

  const select = useCallback(
    (tab: ProductTabId, section?: string) => {
      pendingSection.current = section ?? null;
      setActive(tab);
      window.history.replaceState(null, "", productHref(productId, siteParam, tab));
    },
    [productId, siteParam],
  );

  // After a tab change: scroll to the asked-for section, else back to the tab bar if the page
  // was scrolled past it; keep the active tab visible inside the scrolling tab bar (phones).
  useEffect(() => {
    const section = pendingSection.current;
    pendingSection.current = null;
    if (section) {
      document.getElementById(section)?.scrollIntoView({ block: "start" });
    } else if (topRef.current && topRef.current.getBoundingClientRect().top < 0) {
      topRef.current.scrollIntoView({ block: "start" });
    }
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Old one-page links: /products/…#documents opens Media & Documents at the documents.
  // Read after the first paint (the server cannot see the hash), and on in-page hash changes.
  useEffect(() => {
    const open = () => {
      const tab = tabForHash(window.location.hash);
      if (tab) select(tab, window.location.hash.slice(1));
    };
    const frame = window.requestAnimationFrame(open);
    window.addEventListener("hashchange", open);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", open);
    };
  }, [select]);

  // Leaving with unsaved changes: reload/close, and in-app links (site switch, back link, menu).
  useEffect(() => {
    if (!anyUnsaved) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.dataset["tabLink"] !== undefined || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const url = new URL(a.href, window.location.href);
      const here = window.location;
      if (url.pathname === here.pathname && url.search === here.search) return;
      if (!window.confirm(LEAVE_TEXT)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [anyUnsaved]);

  const unsavedTabs = new Set(Object.values(unsaved));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = PRODUCT_TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % PRODUCT_TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + PRODUCT_TABS.length) % PRODUCT_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PRODUCT_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = PRODUCT_TABS[next]!.id;
    select(tab);
    document.getElementById(tabDomId(base, tab))?.focus();
  }

  const state = useMemo<TabsState>(
    () => ({ active, select, productId, siteParam, setUnsaved }),
    [active, select, productId, siteParam, setUnsaved],
  );

  return (
    <TabsContext.Provider value={state}>
      <div ref={topRef} className="scroll-mt-32" />
      <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-bg px-4 sm:top-16 sm:mx-0 sm:px-0">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Product sections"
          onKeyDown={onKeyDown}
          className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {PRODUCT_TABS.map((t) => {
            const selected = t.id === active;
            const badge = badges[t.id];
            const dirty = unsavedTabs.has(t.id);
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
                {dirty ? (
                  <span className="inline-flex items-center" title="Unsaved changes">
                    <span aria-hidden="true" className="size-2 rounded-full bg-amber" />
                    <span className="sr-only">, unsaved changes</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {anyUnsaved ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30"
        >
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-amber" />
          <span>
            Unsaved changes in{" "}
            {PRODUCT_TABS.filter((t) => unsavedTabs.has(t.id))
              .map((t) => t.label)
              .join(", ")}
            . They are kept while you switch tabs; save each form to keep them for good.
          </span>
        </p>
      ) : null}
      <div className="pt-1">{children}</div>
    </TabsContext.Provider>
  );
}

/** One tab's content; stays mounted (hidden) while another tab is active. */
export function ProductTabPanel({ tab, children }: { tab: ProductTabId; children: ReactNode }) {
  const tabs = useContext(TabsContext);
  const select = tabs?.select;
  const origin = useMemo<NoticeOrigin>(
    () => ({ label: productTabLabel(tab), ...(select ? { open: () => select(tab) } : {}) }),
    [tab, select],
  );
  const hidden = tabs ? tabs.active !== tab : false;
  return (
    <PanelContext.Provider value={tab}>
      <NoticeScope origin={origin}>
        <div
          id={panelDomId(tab)}
          role="tabpanel"
          aria-label={productTabLabel(tab)}
          hidden={hidden}
          className="space-y-6 sm:space-y-8"
        >
          {children}
        </div>
      </NoticeScope>
    </PanelContext.Provider>
  );
}

/**
 * Reports whether the calling form has unsaved changes: marks its tab, guards leaving the page
 * and tells a surrounding `KeepUnsaved` not to remount it. A no-op outside the product tabs.
 */
export function useUnsavedChanges(unsaved: boolean): void {
  const tabs = useContext(TabsContext);
  const tab = useContext(PanelContext);
  const keep = useContext(KeepContext);
  const id = useId();
  const setUnsaved = tabs?.setUnsaved;
  useEffect(() => {
    setUnsaved?.(id, tab, unsaved);
    keep?.(unsaved);
  }, [setUnsaved, keep, id, tab, unsaved]);
  useEffect(() => () => setUnsaved?.(id, tab, false), [setUnsaved, id, tab]);
}

/**
 * Remounts its children when `resetKey` changes (a new saved version), unless they report
 * unsaved changes: then they stay mounted with the new props, and remount once they are clean.
 */
export function KeepUnsaved({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [unsaved, setUnsaved] = useState(false);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey && !unsaved) setKey(resetKey);
  return (
    <KeepContext.Provider value={setUnsaved}>
      <KeepChild key={key}>{children}</KeepChild>
    </KeepContext.Provider>
  );
}

function KeepChild({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * A link to a tab (and a section in it) of this product page. A link to another site's tab is
 * a normal navigation, with the unsaved-changes check.
 */
export function TabLink({
  tab,
  section,
  site,
  className,
  children,
}: {
  tab: ProductTabId;
  section?: string;
  /** The site the fix belongs to (`bv`, `corporate`); omitted for platform-wide fixes. */
  site?: string;
  className?: string;
  children: ReactNode;
}) {
  const tabs = useContext(TabsContext);
  if (!tabs) return <span className={className}>{children}</span>;
  if (site && site !== tabs.siteParam) {
    const href = `${productHref(tabs.productId, site, tab)}${section ? `#${section}` : ""}`;
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const href = productHref(tabs.productId, tabs.siteParam, tab);
  return (
    <a
      href={href}
      data-tab-link=""
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

/** The site switcher of the Content tab; its links keep the active tab. */
export function ProductSiteSwitcher({
  sites,
  current,
}: {
  sites: readonly CatalogSite[];
  current: string;
}) {
  const tabs = useContext(TabsContext);
  const tab = tabs?.active ?? "content";
  const productId = tabs?.productId ?? "";
  return (
    <SiteSwitcher
      sites={sites}
      current={current}
      hrefFor={(s) => productHref(productId, s.key.toLowerCase(), tab)}
    />
  );
}
