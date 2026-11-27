/**
 * COM-1: the frame of every corporate page — skip link, navigation with one level of submenus,
 * language selector, main content and footer — rendered only from the published
 * `corporate.site-nav` / `corporate.site-footer` (nothing from code). A link without a live target
 * is shown as text with the menu's pending note; the Privacy Policy link only where the policy is
 * published. Plain HTML and CSS, no client JavaScript: the visual design is COM-2.
 */
import type { ReactNode } from "react";

import type { NavLink, SiteFooter, SiteNav } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import type { LanguageOption, RouteLocale } from "@/lib/locale-routing";

function Item({ link, note }: { link: NavLink; note: string }) {
  if (!link.href) {
    return (
      <span className="pending">
        {link.label} <small>({note})</small>
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
    </a>
  );
}

function Languages({ options, locale }: { options: LanguageOption[]; locale: RouteLocale }) {
  const t = dictionary(locale);
  return (
    <nav aria-label={t.languages} className="languages">
      <ul>
        {options.map((o) => (
          <li key={o.locale} lang={o.locale}>
            {o.href && !o.current ? (
              <a href={o.href} hrefLang={o.locale}>
                {o.label}
              </a>
            ) : (
              <span aria-current={o.current ? "true" : undefined}>
                {o.label}
                {!o.available ? <small> ({t.comingSoon})</small> : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Header({
  nav,
  languages,
  locale,
}: {
  nav: SiteNav | null;
  languages: LanguageOption[];
  locale: RouteLocale;
}) {
  const t = dictionary(locale);
  return (
    <header className="site-header">
      <a className="brand" href={`/${locale}`}>
        Dream Petroleum
      </a>
      {nav ? (
        <nav aria-label={t.menu} className="main-nav">
          <ul>
            {nav.items.map((item) => (
              <li key={item.label}>
                <Item link={item} note={nav.pendingNote} />
                {item.children.length ? (
                  <ul>
                    {item.children.map((child) => (
                      <li key={child.label}>
                        <Item link={child} note={nav.pendingNote} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {nav.contact ? (
              <li className="contact">
                <Item link={nav.contact} note={nav.pendingNote} />
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
      <Languages options={nav?.languages ?? languages} locale={locale} />
    </header>
  );
}

function Footer({ footer, privacyHref }: { footer: SiteFooter; privacyHref: string | null }) {
  const note = footer.pendingNote;
  // DP-095: the Privacy Policy link only where the policy is published (else no link at all).
  const legal = footer.legal.filter((l) => !l.href?.endsWith("/privacy") || privacyHref !== null);
  return (
    <footer className="site-footer">
      <div className="footer-intro">
        <p className="headline">{footer.headline}</p>
        <p>{footer.intro}</p>
        {footer.cta ? <Item link={footer.cta} note={note} /> : null}
      </div>
      <address>
        <strong>{footer.contact.title}</strong>
        <span>{footer.contact.company}</span>
        {footer.contact.addressLines.map((l) => (
          <span key={l.text}>{l.text}</span>
        ))}
        {footer.contact.phone.visible ? (
          <a href={footer.contact.phone.href}>{footer.contact.phone.label}</a>
        ) : null}
        {footer.contact.email.visible ? (
          <a href={footer.contact.email.href}>{footer.contact.email.label}</a>
        ) : null}
      </address>
      {footer.columns.map((col) => (
        <div key={col.title} className="footer-column">
          <strong>{col.title}</strong>
          <ul>
            {col.links.map((l) => (
              <li key={l.label}>
                <Item link={l} note={note} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {footer.social.length ? (
        <ul className="social">
          {footer.social.map((s) => (
            <li key={s.href}>
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="legal">
        <span>{footer.copyright}</span>
        {legal.map((l) => (
          <Item
            key={l.label}
            link={l.href?.endsWith("/privacy") && privacyHref ? { ...l, href: privacyHref } : l}
            note={note}
          />
        ))}
      </div>
    </footer>
  );
}

export function SiteFrame({
  locale,
  nav,
  footer,
  languages,
  privacyHref,
  children,
}: {
  locale: RouteLocale;
  nav: SiteNav | null;
  footer: SiteFooter | null;
  languages: LanguageOption[];
  /** The policy's address where it is published, null otherwise (DP-095). */
  privacyHref: string | null;
  children: ReactNode;
}) {
  const t = dictionary(locale);
  return (
    <>
      <a className="skip-link" href="#content">
        {t.skipToContent}
      </a>
      <Header nav={nav} languages={languages} locale={locale} />
      <main id="content">{children}</main>
      {footer ? <Footer footer={footer} privacyHref={privacyHref} /> : null}
    </>
  );
}
