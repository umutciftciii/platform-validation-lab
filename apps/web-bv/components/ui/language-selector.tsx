"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { interpolate } from "@/lib/i18n/format";
import { carriedQuery, type LanguageOption } from "@/lib/locale-routing";

const noSubscription = () => () => {};
const browserAddress = () => `${window.location.pathname}${window.location.search}`;
const serverAddress = () => "";

/** The selector's texts in the page's language (lib/i18n `nav`). */
export interface LanguageSelectorUi {
  languageLabel: string;
  languageButton: string;
  languageSoon: string;
}

/**
 * ML-7 (DP-238, ADR-028 D3/D7): the language selector of the BV site.
 *
 * The server builds the options (`languageOptions`): every language the site has routes for; a
 * language that is not public is listed without a link and marked "coming soon", so it becomes
 * selectable by data alone (no deploy) and the server keeps answering 404 under its prefix until
 * then. Each available language goes to the page's published counterpart or that language's home.
 * Plain links: the choice is never stored and never used for an automatic redirect.
 *
 * `dropdown` (the header): a disclosure button with a list of links. Enter, Space and ArrowDown
 * open it on the first option, ArrowUp on the last; ArrowUp/ArrowDown/Home/End move between the
 * options (a not-yet-available one is reachable and announced as unavailable); Escape closes it
 * and returns focus to the button; Tab, a click outside and a choice close it.
 * `list` (the phone menu): the options as an always-open list.
 */
export default function LanguageSelector({
  options,
  ui,
  variant,
  className,
  onNavigate,
}: {
  options: readonly LanguageOption[];
  ui: LanguageSelectorUi;
  variant: "dropdown" | "list";
  className: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.current) ?? options[0];
  // The visitor's address, read in the browser only (the server render has none, so both agree).
  const address = useSyncExternalStore(noSubscription, browserAddress, serverAddress);
  const cut = address.indexOf("?");
  const here = address
    ? { path: cut === -1 ? address : address.slice(0, cut), search: cut === -1 ? "" : address.slice(cut) }
    : null;

  // A click or tap outside closes the list (focus stays where the visitor put it).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!current) return null;

  const items = () =>
    Array.from(root.current?.querySelectorAll<HTMLElement>("[data-language-option]") ?? []);
  const focusItem = (index: number) => {
    const all = items();
    if (all.length === 0) return;
    all[(index + all.length) % all.length]?.focus();
  };
  const openAt = (index: number) => {
    setOpen(true);
    // The list is rendered on the next frame; focus its option then.
    requestAnimationFrame(() => focusItem(index));
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(-1);
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(at + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(at - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(-1);
        break;
      case "Escape":
        if (variant === "dropdown") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
        break;
      case "Tab":
        if (variant === "dropdown") setOpen(false);
        break;
    }
  };

  const choose = () => {
    setOpen(false);
    onNavigate?.();
  };

  // ML-7: a query is carried only where it means the same in the other language (the catalogue
  // filter). Read after hydration, so the server and the first client render agree.
  const hrefOf = (option: LanguageOption & { href: string }) =>
    `${option.href}${here ? carriedQuery(here.path, option.href, here.search) : ""}`;

  const list = (
    <ul
      id={id}
      className="lang-select-list"
      hidden={variant === "dropdown" && !open}
      onKeyDown={onListKeyDown}
    >
      {options.map((o) => (
        <li key={o.locale}>
          {o.href ? (
            <a
              href={hrefOf(o as LanguageOption & { href: string })}
              hrefLang={o.locale}
              lang={o.locale}
              aria-current={o.current ? "true" : undefined}
              className="lang-select-option"
              data-language-option=""
              onClick={choose}
            >
              <span className="lang-select-code" aria-hidden="true">
                {o.locale.toUpperCase()}
              </span>
              <span>{o.label}</span>
            </a>
          ) : (
            <span
              role="link"
              aria-disabled="true"
              aria-current={o.current ? "true" : undefined}
              tabIndex={-1}
              lang={o.locale}
              className="lang-select-option"
              data-language-option=""
              data-unavailable="true"
            >
              <span className="lang-select-code" aria-hidden="true">
                {o.locale.toUpperCase()}
              </span>
              <span>{o.label}</span>
              <span className="lang-select-soon">{ui.languageSoon}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  if (variant === "list") {
    return (
      <nav aria-label={ui.languageLabel} className={className} ref={root}>
        {list}
      </nav>
    );
  }

  return (
    <div
      className={className}
      data-open={open}
      ref={(el) => {
        root.current = el;
      }}
    >
      <button
        ref={button}
        type="button"
        className="lang-select-button"
        aria-label={interpolate(ui.languageButton, { language: current.label })}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={onButtonKeyDown}
      >
        <span aria-hidden="true">{current.locale.toUpperCase()}</span>
        <span aria-hidden="true" className="site-nav-sub-chevron" />
      </button>
      {list}
    </div>
  );
}
