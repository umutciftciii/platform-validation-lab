import Image from "next/image";

import { type FooterLink, type SiteFooterContent } from "@/content/site-footer";
import { PRIVACY_PATH, privacyHref } from "@/lib/privacy";

/**
 * Page footer. A server component with no client script: every link works with
 * JavaScript off, and the entrance is CSS only (see `.site-footer` in globals.css). CMS S2: the
 * content comes from the published `bv.site-footer` fragment (lib/cms-home.ts).
 */
export default function SiteFooter({
  content,
}: {
  content: SiteFooterContent;
}) {
  const { contact } = content;

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-call">
          <h2 className="site-footer-headline">{content.headline}</h2>
          <a href={content.cta.href} className="site-footer-cta">
            {content.cta.label}
          </a>
        </div>

        <div className="site-footer-line" aria-hidden="true" />

        <div className="site-footer-main">
          <div className="site-footer-about">
            <a
              href={content.homeHref}
              className="site-footer-logo"
              aria-label={`${content.logo.alt}, ${content.homeLabel}`}
            >
              <Image
                src={content.logo.src}
                alt=""
                width={content.logo.width}
                height={content.logo.height}
              />
            </a>
            <p className="site-footer-intro">{content.intro}</p>

            <h3 className="site-footer-heading">{contact.title}</h3>
            <address className="site-footer-contact">
              <p>
                {contact.company}
                {contact.addressLines.map((line) => (
                  <span key={line} className="site-footer-address-line">
                    {line}
                  </span>
                ))}
              </p>
              <p>
                <a href={contact.phone.href} className="site-footer-link">
                  {contact.phone.label}
                </a>
                <span className="site-footer-note">{contact.phone.note}</span>
              </p>
              <p>
                <a href={contact.email.href} className="site-footer-link">
                  {contact.email.label}
                </a>
                <span className="site-footer-note">{contact.email.note}</span>
              </p>
            </address>
          </div>

          <nav aria-label={content.navLabel} className="site-footer-nav">
            {content.columns.map((column) => (
              <div key={column.title} className="site-footer-column">
                <h3 className="site-footer-heading">{column.title}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <FooterItem link={link} pendingNote={content.pendingNote} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="site-footer-base">
          <p>{content.copyright}</p>
          <ul aria-label={content.legalLabel} className="site-footer-legal">
            {content.legal.map((link) => (
              <li key={link.label}>
                <FooterItem
                  link={link.href === PRIVACY_PATH ? { ...link, href: privacyHref() } : link}
                  pendingNote={content.pendingNote}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

/** A real link, or plain text when the page does not exist yet. */
function FooterItem({
  link,
  pendingNote,
}: {
  link: FooterLink;
  pendingNote: string;
}) {
  if (link.href === null) {
    return (
      <span className="site-footer-pending">
        {link.label}
        <span className="sr-only"> ({pendingNote})</span>
      </span>
    );
  }
  return (
    <a href={link.href} className="site-footer-link">
      {link.label}
    </a>
  );
}
