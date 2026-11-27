/**
 * COM-2a: the frame of every corporate page — skip link, header (components/site-header.tsx),
 * main content and footer — rendered only from the published `corporate.site-nav` /
 * `corporate.site-footer` (nothing from code). A link without a live target is shown as text with
 * the menu's pending note; the Privacy Policy link only where the policy is published (DP-095).
 * A preview (DP-321) carries a bar that says so.
 * COM-6: the cookie choice (components/cookie-consent.tsx) where GA4 is configured for the
 * environment; never in a preview (a draft is not measured). "Cookie settings" in the footer
 * reopens it.
 */
import type { ReactNode } from "react";

import { CookieConsent, CookieSettingsButton } from "@/components/cookie-consent";
import { SiteHeader, type HeaderLabels } from "@/components/site-header";
import type { NavLink, SiteFooter, SiteNav } from "@/lib/cms";
import { measurementIdOf } from "@/lib/consent";
import { dictionary } from "@/lib/i18n";
import { localePath, type LanguageOption, type RouteLocale } from "@/lib/locale-routing";

function FooterLink({ link, note, newTab }: { link: NavLink; note: string; newTab: string }) {
  if (!link.href) {
    return (
      <span className="pending">
        {link.label} <span className="pending-note">({note})</span>
      </span>
    );
  }
  return (
    <a
      href={link.href}
      aria-current={link.current ? "page" : undefined}
      {...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {link.label}
      {link.newTab ? <span className="sr-only"> {newTab}</span> : null}
    </a>
  );
}

function Footer({
  footer,
  privacyHref,
  locale,
  cookieSettings,
}: {
  footer: SiteFooter;
  privacyHref: string | null;
  locale: RouteLocale;
  /** COM-6: the "Cookie settings" button where the cookie choice is shown. */
  cookieSettings: boolean;
}) {
  const t = dictionary(locale);
  const note = footer.pendingNote;
  // DP-095: the Privacy Policy link only where the policy is published (else no link at all).
  const legal = footer.legal
    .filter((l) => !l.href?.endsWith("/privacy") || privacyHref !== null)
    .map((l) => (l.href?.endsWith("/privacy") && privacyHref ? { ...l, href: privacyHref } : l));
  const { contact } = footer;
  return (
    <footer className="site-footer on-dark" aria-label={t.footer.label}>
      <div className="container-site">
        <div className="footer-top">
          <p className="footer-headline">{footer.headline}</p>
          <div>
            <p className="footer-intro">{footer.intro}</p>
            {footer.cta ? (
              footer.cta.href ? (
                <a href={footer.cta.href} className="btn btn-accent btn-arrow">
                  {footer.cta.label}
                </a>
              ) : (
                <FooterLink link={footer.cta} note={note} newTab={t.newTab} />
              )
            ) : null}
          </div>
        </div>
        <div aria-hidden className="footer-rule" />
      </div>
      <div className="container-site footer-grid">
        <div>
          <h2 className="footer-title">{contact.title}</h2>
          <address>
            <span className="footer-company">{contact.company}</span>
            {contact.addressLines.map((l) => (
              <span key={l.text}>{l.text}</span>
            ))}
            <span className="footer-contact-lines">
              {contact.phone.visible ? (
                <a href={contact.phone.href}>{contact.phone.label}</a>
              ) : null}
              {contact.email.visible ? (
                <a href={contact.email.href}>{contact.email.label}</a>
              ) : null}
            </span>
          </address>
        </div>
        {footer.columns.map((col) => (
          <div key={col.title}>
            <h2 className="footer-title">{col.title}</h2>
            <ul className="footer-list">
              {col.links.map((l) => (
                <li key={l.label}>
                  <FooterLink link={l} note={note} newTab={t.newTab} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {footer.social.length ? (
          <div>
            <h2 className="footer-title">{t.footer.social}</h2>
            <ul className="footer-list">
              {footer.social.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer">
                    {s.label}
                    <span className="sr-only"> {t.newTab}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="container-site">
        <div aria-hidden className="footer-rule" />
        <div className="footer-bottom">
          <span>{footer.copyright}</span>
          {legal.length || cookieSettings ? (
            <nav aria-label={t.footer.legal}>
              <ul className="footer-legal">
                {legal.map((l) => (
                  <li key={l.label}>
                    <FooterLink link={l} note={note} newTab={t.newTab} />
                  </li>
                ))}
                {cookieSettings ? (
                  <li>
                    <CookieSettingsButton label={t.cookies.settings} />
                  </li>
                ) : null}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function headerLabels(locale: RouteLocale): HeaderLabels {
  const t = dictionary(locale);
  return {
    menu: t.menu,
    languages: t.languages,
    comingSoon: t.comingSoon,
    openMenu: t.openMenu,
    closeMenu: t.closeMenu,
    openSubmenu: t.openSubmenu,
    newTab: t.newTab,
    homeLink: t.homeLink,
  };
}

export function SiteFrame({
  locale,
  nav,
  footer,
  languages,
  privacyHref,
  preview = false,
  overlay = false,
  children,
}: {
  locale: RouteLocale;
  nav: SiteNav | null;
  footer: SiteFooter | null;
  languages: LanguageOption[];
  /** The policy's address where it is published, null otherwise (DP-095). */
  privacyHref: string | null;
  /** DP-321: a draft shown through a signed preview link. */
  preview?: boolean;
  /** COM-7: the page opens with a full-width picture (the header lies over it; not in a preview). */
  overlay?: boolean;
  children: ReactNode;
}) {
  const t = dictionary(locale);
  // COM-6: per environment, never in code; without an id there is no optional cookie to ask for.
  const measurementId = preview ? null : measurementIdOf();
  return (
    <>
      <a className="skip-link" href="#content">
        {t.skipToContent}
      </a>
      {preview ? (
        <div role="note" className="preview-bar">
          <p className="container-site m-0">
            <strong>{t.preview.badge}</strong>
            {t.preview.text}
          </p>
        </div>
      ) : null}
      <SiteHeader
        homeHref={localePath(locale, "/")}
        nav={nav}
        languages={languages}
        labels={headerLabels(locale)}
        overlay={overlay && !preview}
      />
      <main id="content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      {footer ? (
        <Footer
          footer={footer}
          privacyHref={privacyHref}
          locale={locale}
          cookieSettings={measurementId !== null}
        />
      ) : null}
      {measurementId ? (
        <CookieConsent measurementId={measurementId} labels={t.cookies} privacyHref={privacyHref} />
      ) : null}
    </>
  );
}
