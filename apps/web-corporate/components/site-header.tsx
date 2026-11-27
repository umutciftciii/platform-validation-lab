"use client";

/**
 * COM-2a: the corporate header — wordmark, main menu with one level of submenus, language
 * selector, contact button and, on phones and tablets, a full-screen menu. Every item comes from
 * the published `corporate.site-nav` (nothing from code); the state rules are lib/menu-state.ts.
 *
 * Keyboard: every control is a link or a button. A submenu opens with its button (Enter/Space),
 * Esc closes it and returns focus to the button; focus leaving it closes it. The phone menu is a
 * modal <dialog> (focus stays inside, Esc closes it, focus returns to the menu button).
 * Without JavaScript: submenus open on hover and focus, and the phone menu button is replaced by
 * the navigation's no-script links (`noScriptLinks`) and the languages.
 * A link whose page is not ready yet is announced as unavailable and shows the menu's note.
 */
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { interpolate } from "@/lib/i18n";
import type { NavLink, SiteNav } from "@/lib/menu-view";
import type { LanguageOption } from "@/lib/locale-routing";
import {
  INITIAL_MENU_STATE,
  NOTICE_MS,
  WIDE_MIN_PX,
  menuReducer,
  type MenuAction,
} from "@/lib/menu-state";

export interface HeaderLabels {
  menu: string;
  languages: string;
  comingSoon: string;
  openMenu: string;
  closeMenu: string;
  /** With `{label}`. */
  openSubmenu: string;
  newTab: string;
  homeLink: string;
}

const NO_SCRIPT_CSS =
  ".menu-toggle{display:none!important}" +
  ".nav-item:hover>.nav-sub,.nav-item:focus-within>.nav-sub{visibility:visible;opacity:1;translate:0 0}";

type Dispatch = (action: MenuAction) => void;

function Wordmark({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="wordmark" aria-label={label}>
      <span aria-hidden className="wordmark-mark" />
      <span aria-hidden>Dream Petroleum</span>
    </a>
  );
}

function ItemLink({
  link,
  className,
  labels,
  pendingNote,
  dispatch,
}: {
  link: NavLink;
  className: string;
  labels: HeaderLabels;
  pendingNote: string;
  dispatch: Dispatch;
}) {
  if (link.href === null) {
    // Not ready yet: focusable, announced as unavailable; activating it shows the note.
    const show = (e: MouseEvent | KeyboardEvent) => {
      e.preventDefault();
      dispatch({ type: "pending" });
    };
    return (
      <a
        role="link"
        aria-disabled="true"
        tabIndex={0}
        title={pendingNote}
        className={className}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Enter") show(e);
        }}
      >
        {link.label}
        <span className="sr-only"> ({pendingNote})</span>
      </a>
    );
  }
  return (
    <a
      href={link.href}
      className={className}
      aria-current={link.current ? "page" : undefined}
      onClick={() => {
        // Following a link closes the menus (a link to another tab leaves them as they are).
        if (!link.newTab) dispatch({ type: "navigate" });
      }}
      {...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {link.label}
      {link.newTab ? <span className="sr-only"> {labels.newTab}</span> : null}
    </a>
  );
}

function DesktopItem({
  item,
  index,
  open,
  labels,
  pendingNote,
  dispatch,
}: {
  item: SiteNav["items"][number];
  index: number;
  open: boolean;
  labels: HeaderLabels;
  pendingNote: string;
  dispatch: Dispatch;
}) {
  const id = useId();
  if (item.children.length === 0) {
    return (
      <li className="nav-item">
        <ItemLink
          link={item}
          className="nav-link"
          labels={labels}
          pendingNote={pendingNote}
          dispatch={dispatch}
        />
      </li>
    );
  }
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    dispatch({ type: "closeSubmenu" });
    e.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const onBlur = (e: FocusEvent<HTMLLIElement>) => {
    if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      dispatch({ type: "closeSubmenu" });
    }
  };
  const toggle = () => dispatch({ type: "toggleSubmenu", index });
  return (
    <li
      className="nav-item"
      data-open={open}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onMouseLeave={() => {
        if (open) dispatch({ type: "closeSubmenu" });
      }}
    >
      {item.href === null ? (
        // A group without a page of its own: the button opens its submenu.
        <button
          type="button"
          className="nav-link"
          aria-expanded={open}
          aria-controls={id}
          data-current={item.current ? "true" : undefined}
          onClick={toggle}
        >
          {item.label}
          <span aria-hidden className="chevron" />
        </button>
      ) : (
        <>
          <ItemLink
            link={item}
            className="nav-link"
            labels={labels}
            pendingNote={pendingNote}
            dispatch={dispatch}
          />
          <button
            type="button"
            className="nav-sub-toggle"
            aria-label={interpolate(labels.openSubmenu, { label: item.label })}
            aria-expanded={open}
            aria-controls={id}
            onClick={toggle}
          >
            <span aria-hidden className="chevron" />
          </button>
        </>
      )}
      <ul id={id} className="nav-sub">
        {item.children.map((child) => (
          <li key={child.label}>
            <ItemLink
              link={child}
              className=""
              labels={labels}
              pendingNote={pendingNote}
              dispatch={dispatch}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The language selector: the page's counterpart in each public language; others "coming soon". */
export function Languages({
  options,
  label,
  comingSoon,
  className,
}: {
  options: LanguageOption[];
  label: string;
  comingSoon: string;
  className?: string;
}) {
  if (options.length < 2) return null;
  return (
    <nav aria-label={label} className={`languages ${className ?? ""}`}>
      <ul>
        {options.map((o) => (
          <li key={o.locale}>
            {o.href && !o.current ? (
              <a href={o.href} hrefLang={o.locale} lang={o.locale}>
                <span aria-hidden>{o.locale.toUpperCase()}</span>
                <span className="sr-only">{o.label}</span>
              </a>
            ) : (
              <span
                data-lang={o.locale}
                lang={o.locale}
                aria-current={o.current ? "true" : undefined}
                data-unavailable={!o.available ? "true" : undefined}
                title={!o.available ? `${o.label} — ${comingSoon}` : undefined}
              >
                <span aria-hidden>{o.locale.toUpperCase()}</span>
                <span className="sr-only">
                  {o.label}
                  {!o.available ? ` (${comingSoon})` : ""}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteHeader({
  homeHref,
  nav,
  languages,
  labels,
}: {
  homeHref: string;
  nav: SiteNav | null;
  languages: LanguageOption[];
  labels: HeaderLabels;
}) {
  const [state, dispatch] = useReducer(menuReducer, INITIAL_MENU_STATE);
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingNote = nav?.pendingNote ?? "";

  // The dialog follows the state (showModal traps focus; close returns it to the menu button).
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (state.mobileOpen && !d.open) d.showModal();
    if (!state.mobileOpen && d.open) d.close();
  }, [state.mobileOpen]);

  // A phone menu left open while the window widens would leave the page inert.
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${WIDE_MIN_PX}px)`);
    const onChange = () => {
      if (wide.matches) dispatch({ type: "wideScreen" });
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!state.notice) return;
    const timer = window.setTimeout(() => dispatch({ type: "noticeDone" }), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [state.notice]);

  const options = nav?.languages ?? languages;

  return (
    <header className="site-header">
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
      </noscript>
      <div className="container-site site-header-bar">
        <Wordmark href={homeHref} label={labels.homeLink} />

        {nav ? (
          <nav aria-label={labels.menu} className="main-nav">
            <ul>
              {nav.items.map((item, index) => (
                <DesktopItem
                  key={item.label}
                  item={item}
                  index={index}
                  open={state.openSubmenu === index}
                  labels={labels}
                  pendingNote={pendingNote}
                  dispatch={dispatch}
                />
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="header-end">
          <Languages
            options={options}
            label={labels.languages}
            comingSoon={labels.comingSoon}
            className="languages-bar"
          />
          {nav?.contact ? (
            <ItemLink
              link={nav.contact}
              className="btn btn-accent header-contact"
              labels={labels}
              pendingNote={pendingNote}
              dispatch={dispatch}
            />
          ) : null}
          {nav ? (
            <button
              type="button"
              className="menu-toggle"
              aria-label={labels.openMenu}
              aria-haspopup="dialog"
              aria-expanded={state.mobileOpen}
              aria-controls="site-menu"
              onClick={() => dispatch({ type: "openMobile" })}
            >
              <span aria-hidden className="menu-lines" />
            </button>
          ) : null}
        </div>

        <p role="status" className="nav-notice">
          {state.notice && !state.mobileOpen ? pendingNote : ""}
        </p>
      </div>

      {nav ? (
        <noscript>
          <nav aria-label={labels.menu} className="nav-fallback container-site">
            <ul>
              {nav.noScriptLinks.map((l) => (
                <li key={l.label}>
                  <a href={l.href as string} aria-current={l.current ? "page" : undefined}>
                    {l.label}
                  </a>
                </li>
              ))}
              {options
                .filter((o) => o.href && !o.current)
                .map((o) => (
                  <li key={o.locale}>
                    <a href={o.href as string} hrefLang={o.locale} lang={o.locale}>
                      {o.label}
                    </a>
                  </li>
                ))}
            </ul>
          </nav>
        </noscript>
      ) : null}

      {nav ? (
        <dialog
          ref={dialog}
          id="site-menu"
          aria-label={labels.menu}
          className="mobile-menu on-dark"
          onClose={() => dispatch({ type: "closeMobile" })}
          onCancel={(e) => {
            // Esc: the state closes the dialog (and an open submenu first).
            e.preventDefault();
            dispatch({ type: "escape" });
          }}
        >
          <div className="container-site mobile-menu-bar">
            <Wordmark href={homeHref} label={labels.homeLink} />
            <button
              type="button"
              autoFocus
              className="menu-close"
              aria-label={labels.closeMenu}
              onClick={() => dispatch({ type: "closeMobile" })}
            >
              <span aria-hidden className="menu-close-lines" />
            </button>
          </div>
          <nav aria-label={labels.menu} className="container-site">
            <ul className="mobile-menu-list">
              {nav.items.map((item) => (
                <li key={item.label}>
                  {item.children.length && item.href === null ? (
                    <span className="mobile-group">{item.label}</span>
                  ) : (
                    <ItemLink
                      link={item}
                      className="mobile-link"
                      labels={labels}
                      pendingNote={pendingNote}
                      dispatch={dispatch}
                    />
                  )}
                  {item.children.length ? (
                    <ul className="mobile-sub">
                      {item.children.map((child) => (
                        <li key={child.label}>
                          <ItemLink
                            link={child}
                            className=""
                            labels={labels}
                            pendingNote={pendingNote}
                            dispatch={dispatch}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <div className="container-site mobile-menu-foot">
            <p role="status" className="mobile-notice">
              {state.notice && state.mobileOpen ? pendingNote : ""}
            </p>
            {nav.contact ? (
              <ItemLink
                link={nav.contact}
                className="btn btn-accent"
                labels={labels}
                pendingNote={pendingNote}
                dispatch={dispatch}
              />
            ) : null}
            <Languages options={options} label={labels.languages} comingSoon={labels.comingSoon} />
          </div>
        </dialog>
      ) : null}
    </header>
  );
}
