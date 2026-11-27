/**
 * COM-1: the corporate navigation and footer as the frame shows them, from the public shape the API
 * sends (contracts `BvNavPublic`, `BvFooterPublic`; the menus of both sites share one schema).
 * The menus store addresses as the API does (ML-2: no prefix in the default language), so the
 * current item is found against the page's stored address; the caller then prefixes every link
 * for the page's language (`localizeLinks`).
 *
 * Pure (no Next.js, no fetch, no `@/` imports) so `node --test` runs it as is.
 */
import type { BvFooterPublic, BvNavPublic } from "@dream/contracts";

import type { LanguageOption } from "./locale-routing.ts";

export interface NavLink {
  label: string;
  /** null: shown as text with the pending note. */
  href: string | null;
  newTab: boolean;
  current: boolean;
}

export interface SiteNav {
  items: (NavLink & { children: NavLink[] })[];
  contact: NavLink | null;
  /** COM-2a: the links shown instead of the menus while JavaScript is off. */
  noScriptLinks: NavLink[];
  pendingNote: string;
  languages: LanguageOption[];
}

export interface SiteFooter {
  headline: string;
  cta: NavLink | null;
  intro: string;
  contact: BvFooterPublic["contact"];
  columns: { title: string; links: NavLink[] }[];
  social: BvFooterPublic["social"];
  copyright: string;
  legal: NavLink[];
  pendingNote: string;
}

/** Whether `href` (a public address) is the page at `currentPath` or a parent of it. */
export function isCurrentPath(href: string | null, currentPath: string): boolean {
  if (!href || !href.startsWith("/") || href.includes("#")) return false;
  const path = href.split("?")[0] as string;
  if (path === "/" || currentPath === "/") return path === currentPath;
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

function link(l: BvNavPublic["contact"] & object, currentPath: string): NavLink {
  return {
    label: l.label,
    href: l.href,
    newTab: l.newTab,
    current: isCurrentPath(l.href, currentPath),
  };
}

/** The public navigation of the API as the frame shows it (`currentPath`: stored address). */
export function toNav(c: BvNavPublic, currentPath: string): Omit<SiteNav, "languages"> {
  return {
    items: c.items.map((i) => {
      const children = i.children.map((ch) => link(ch, currentPath));
      const own = link(i, currentPath);
      return { ...own, current: own.current || children.some((ch) => ch.current), children };
    }),
    contact: c.contact ? { ...link(c.contact, currentPath), current: false } : null,
    // Only links with a live target: without JavaScript nothing explains a pending item.
    noScriptLinks: c.noScriptLinks.filter((l) => l.href !== null).map((l) => link(l, currentPath)),
    pendingNote: c.pendingNote,
  };
}

export function toFooter(c: BvFooterPublic): SiteFooter {
  const l = (x: BvFooterPublic["legal"][number]): NavLink => ({ ...x, current: false });
  return {
    headline: c.headline,
    cta: c.cta ? l(c.cta) : null,
    intro: c.intro,
    contact: c.contact,
    columns: c.columns.map((col) => ({ title: col.title, links: col.links.map(l) })),
    social: c.social,
    copyright: c.copyright,
    legal: c.legal.map(l),
    pendingNote: c.pendingNote,
  };
}
