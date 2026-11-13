"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { SITE_NAV_UI, type SiteNavContent, type SiteNavItem } from "@/content/site-nav";

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
  const current = "current" in item && item.current ? "page" : undefined;

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

  // A same-page anchor is a plain link: it has no route for the router to resolve.
  if (item.href.startsWith("#")) {
    return (
      <a href={item.href} aria-current={current} className={className} onClick={onNavigate}>
        {item.label}
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
    >
      {item.label}
    </Link>
  );
}

function Logo({ href, onNavigate }: { href: string; onNavigate?: () => void }) {
  return (
    <a href={href} className="site-nav-logo" onClick={onNavigate}>
      <Image
        src={SITE_NAV_UI.logo.src}
        alt={SITE_NAV_UI.logo.alt}
        width={SITE_NAV_UI.logo.width}
        height={SITE_NAV_UI.logo.height}
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
    <header className="site-nav" data-scrolled={scrolled}>
      <noscript>
        {/* The menu button needs JavaScript. Plain links replace it below. */}
        <style>{".site-nav-toggle { display: none; }"}</style>
      </noscript>

      <div className="site-nav-inner">
        <Logo href={NAV.homeHref} />

        <nav aria-label={NAV.mainLabel} className="site-nav-links">
          <ul>
            {NAV.items.map((item) => (
              <li key={item.label}>
                <NavLink
                  item={item}
                  className="site-nav-link"
                  onPending={showNotice}
                  pendingNote={NAV.pendingNote}
                />
              </li>
            ))}
          </ul>
        </nav>

        <NavLink
          pendingNote={NAV.pendingNote}
          item={NAV.contact}
          className="site-nav-contact"
          onPending={showNotice}
        />

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

        <p role="status" className="site-nav-notice">
          {notice && !menuOpen ? NAV.pendingNote : ""}
        </p>
      </div>

      <noscript>
        <nav aria-label={NAV.mainLabel} className="site-nav-fallback">
          <ul>
            {NAV.noScriptLinks.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  aria-current={"current" in item && item.current ? "page" : undefined}
                  className="site-nav-link"
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
          <Logo href={NAV.homeHref} onNavigate={closeMenu} />
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
                <NavLink
                  pendingNote={NAV.pendingNote}
                  item={item}
                  className="site-menu-link"
                  onNavigate={closeMenu}
                  onPending={showNotice}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-menu-foot">
          <p role="status" className="site-menu-notice">
            {notice && menuOpen ? NAV.pendingNote : ""}
          </p>
          <NavLink
          pendingNote={NAV.pendingNote}
            item={NAV.contact}
            className="site-nav-contact site-nav-contact-wide"
            onPending={showNotice}
          />
        </div>
      </dialog>
    </header>
  );
}
