"use client";

import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import LanguageSelector from "@/components/ui/language-selector";
import type { SiteNavContent, SiteNavItem } from "@/content/site-nav";
import { interpolate } from "@/lib/i18n/format";

/** ML-6: the control labels of the navigation in the page's language (from the server's content). */
const NavUi = createContext<Pick<SiteNavContent, "newTab" | "openSubmenu">>({ newTab: "", openSubmenu: "" });

const SCROLLED_AFTER_PX = 8;
const NOTICE_MS = 2600;
const DESKTOP_QUERY = "(min-width: 1024px)";
const PAGE_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

function subscribeToScroll(notify: () => void) {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
}

function useScrolled() {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > SCROLLED_AFTER_PX,
    () => false,
  );
}

function NavLink({
  item,
  className,
  onNavigate,
  onPending,
  pendingNote,
}: {
  item: SiteNavItem;
  className: string;
  onNavigate?: () => void;
  onPending: () => void;
  pendingNote: string;
}) {
  const ui = useContext(NavUi);
  const current = "current" in item && item.current ? "page" : undefined;
  // DP-219: a link the CMS opens in a new tab says so to screen readers.
  const newTab = item.newTab
    ? ({ target: "_blank", rel: "noopener noreferrer" } as const)
    : undefined;
  const newTabNote = item.newTab ? (
    <span className="sr-only"> {ui.newTab}</span>
  ) : null;

  if (item.href === null) {
    const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onPending();
    };
    const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onPending();
    };
    return (
      <a
        role="link"
        aria-disabled="true"
        tabIndex={0}
        title={pendingNote}
        className={className}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {item.label}
      </a>
    );
  }

  // A same-page anchor is a plain link: it has no route for the router to resolve. DP-219: so is
  // an external address (https, mailto, tel).
  if (!item.href.startsWith("/") || item.href.startsWith("//")) {
    return (
      <a
        href={item.href}
        aria-current={current}
        className={className}
        onClick={onNavigate}
        {...newTab}
      >
        {item.label}
        {newTabNote}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={current}
      className={className}
      onClick={onNavigate}
      {...newTab}
    >
      {item.label}
      {newTabNote}
    </Link>
  );
}

/**
 * DP-219: a desktop item with a submenu. The submenu opens on hover (pointer devices), with its
 * button (keyboard, touch) and, without script, while focus is inside it; Esc and leaving it close
 * it. An item whose own page is not set only opens its submenu.
 */
function DesktopItem({
  item,
  onPending,
  pendingNote,
}: {
  item: SiteNavItem;
  onPending: () => void;
  pendingNote: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ui = useContext(NavUi);
  const children = item.children ?? [];
  if (children.length === 0) {
    return (
      <NavLink item={item} className="site-nav-link" onPending={onPending} pendingNote={pendingNote} />
    );
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      setOpen(false);
      event.currentTarget.querySelector("button")?.focus();
    }
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  return (
    <div
      className="site-nav-has-sub"
      data-open={open}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {item.href === null ? (
        <button
          type="button"
          className="site-nav-link"
          aria-expanded={open}
          aria-controls={id}
          data-current={item.current ? "true" : undefined}
          onClick={() => setOpen(!open)}
        >
          {item.label}
          <span aria-hidden className="site-nav-sub-chevron" />
        </button>
      ) : (
        <>
          <NavLink
            item={item}
            className="site-nav-link"
            onPending={onPending}
            pendingNote={pendingNote}
          />
          <button
            type="button"
            className="site-nav-sub-toggle"
            aria-label={interpolate(ui.openSubmenu, { label: item.label })}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden className="site-nav-sub-chevron" />
          </button>
        </>
      )}
      <ul id={id} className="site-nav-sub">
        {children.map((child) => (
          <li key={child.label}>
            <NavLink
              item={child}
              className="site-nav-sublink"
              onNavigate={() => setOpen(false)}
              onPending={onPending}
              pendingNote={pendingNote}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** DP-219: an item of the phone menu with its submenu, always open under it. */
function MenuItem({
  item,
  onNavigate,
  onPending,
  pendingNote,
}: {
  item: SiteNavItem;
  onNavigate: () => void;
  onPending: () => void;
  pendingNote: string;
}) {
  const children = item.children ?? [];
  return (
    <>
      {children.length && item.href === null ? (
        <span className="site-menu-link site-menu-group">{item.label}</span>
      ) : (
        <NavLink
          pendingNote={pendingNote}
          item={item}
          className="site-menu-link"
          onNavigate={onNavigate}
          onPending={onPending}
        />
      )}
      {children.length ? (
        <ul className="site-menu-sub">
          {children.map((child) => (
            <li key={child.label}>
              <NavLink
                pendingNote={pendingNote}
                item={child}
                className="site-menu-sublink"
                onNavigate={onNavigate}
                onPending={onPending}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Logo({
  href,
  logo,
  onNavigate,
}: {
  href: string;
  logo: SiteNavContent["logo"];
  onNavigate?: () => void;
}) {
  return (
    <a href={href} className="site-nav-logo" onClick={onNavigate}>
      <Image
        src={logo.src}
        alt={logo.alt}
        width={logo.width}
        height={logo.height}
        loading="eager"
        draggable={false}
      />
    </a>
  );
}

/** CMS S2: items and links come from the published `bv.site-nav` fragment (lib/cms-home.ts). */
export default function SiteNav({ content: NAV }: { content: SiteNavContent }) {
  const scrolled = useScrolled();
  const menuRef = useRef<HTMLDialogElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState(false);

  const showNotice = () => {
    setNotice(true);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(false), NOTICE_MS);
  };
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const openMenu = () => {
    menuRef.current?.showModal();
    setMenuOpen(true);
  };
  const closeMenu = () => menuRef.current?.close();

  // The modal dialog handles the focus trap, Esc and returning focus to the button.
  // A menu left open while the window widens would otherwise leave the page inert.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (desktop.matches) menuRef.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  // The page stays where it is behind the menu. Locking body overflow is avoided on
  // purpose: it can shift the layout and move the scroll position the hero reads.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const holdPage = (event: Event) => {
      if (menu.scrollHeight <= menu.clientHeight) event.preventDefault();
    };
    menu.addEventListener("wheel", holdPage, { passive: false });
    menu.addEventListener("touchmove", holdPage, { passive: false });
    return () => {
      menu.removeEventListener("wheel", holdPage);
      menu.removeEventListener("touchmove", holdPage);
    };
  }, []);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (!PAGE_SCROLL_KEYS.has(event.key)) return;
    const onButton = (event.target as HTMLElement).tagName === "BUTTON";
    if (event.key === " " && onButton) return;
    event.preventDefault();
  };

  return (
    <NavUi.Provider value={{ newTab: NAV.newTab, openSubmenu: NAV.openSubmenu }}>
    <header className="site-nav" data-scrolled={scrolled}>
      <noscript>
        {/* The menu button needs JavaScript. Plain links replace it below. */}
        <style>{".site-nav-toggle { display: none; }"}</style>
      </noscript>

      <div className="site-nav-inner">
        <Logo href={NAV.homeHref} logo={NAV.logo} />

        <nav aria-label={NAV.mainLabel} className="site-nav-links">
          <ul>
            {NAV.items.map((item) => (
              <li key={item.label}>
                <DesktopItem item={item} onPending={showNotice} pendingNote={NAV.pendingNote} />
              </li>
            ))}
          </ul>
        </nav>

        {/* ML-7: the right of the bar — language selector, contact button (wide screens) and the
            menu button (phones and tablets). */}
        <div className="site-nav-end">
          <Languages content={NAV} variant="dropdown" className="site-nav-languages" />

          {NAV.contact ? (
            <NavLink
              pendingNote={NAV.pendingNote}
              item={NAV.contact}
              className="site-nav-contact"
              onPending={showNotice}
            />
          ) : null}

          <button
            type="button"
            className="site-nav-toggle"
            aria-label={NAV.openMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={openMenu}
          >
            <span aria-hidden className="site-nav-toggle-lines" />
          </button>
        </div>

        <p role="status" className="site-nav-notice">
          {notice && !menuOpen ? NAV.pendingNote : ""}
        </p>
      </div>

      <noscript>
        <nav aria-label={NAV.mainLabel} className="site-nav-fallback">
          <ul>
            {(NAV.languages ?? [])
              .filter((l) => l.href && !l.current)
              .map((l) => (
                <li key={`lang-${l.locale}`}>
                  <a href={l.href as string} hrefLang={l.locale} lang={l.locale} className="site-nav-link">
                    {l.label}
                  </a>
                </li>
              ))}
            {NAV.noScriptLinks.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  aria-current={"current" in item && item.current ? "page" : undefined}
                  className="site-nav-link"
                  {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </noscript>

      <dialog
        ref={menuRef}
        id="site-menu"
        aria-label={NAV.menuLabel}
        className="site-menu"
        onClose={() => setMenuOpen(false)}
        onKeyDown={onMenuKeyDown}
      >
        <div className="site-menu-bar">
          <Logo href={NAV.homeHref} logo={NAV.logo} onNavigate={closeMenu} />
          <button
            type="button"
            autoFocus
            className="site-menu-close"
            aria-label={NAV.closeMenu}
            onClick={closeMenu}
          >
            <span aria-hidden className="site-menu-close-lines" />
          </button>
        </div>

        <nav aria-label={NAV.menuLabel}>
          <ul className="site-menu-list">
            {NAV.items.map((item) => (
              <li key={item.label}>
                <MenuItem
                  item={item}
                  onNavigate={closeMenu}
                  onPending={showNotice}
                  pendingNote={NAV.pendingNote}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-menu-foot">
          <p role="status" className="site-menu-notice">
            {notice && menuOpen ? NAV.pendingNote : ""}
          </p>
          {NAV.contact ? (
            <NavLink
              pendingNote={NAV.pendingNote}
              item={NAV.contact}
              className="site-nav-contact site-nav-contact-wide"
              onPending={showNotice}
            />
          ) : null}
          <Languages
            content={NAV}
            variant="list"
            className="site-menu-languages"
            onNavigate={closeMenu}
          />
        </div>
      </dialog>
    </header>
    </NavUi.Provider>
  );
}

/**
 * ML-7 (ADR-028 D3/D7): the language selector of the bar and of the phone menu. The server builds
 * the options (every language; one that is not public yet is shown as "coming soon", no link).
 */
function Languages({
  content,
  variant,
  className,
  onNavigate,
}: {
  content: SiteNavContent;
  variant: "dropdown" | "list";
  className: string;
  onNavigate?: () => void;
}) {
  const languages = content.languages ?? [];
  if (languages.length === 0) return null;
  return (
    <LanguageSelector
      options={languages}
      ui={content}
      variant={variant}
      className={className}
      onNavigate={onNavigate}
    />
  );
}
