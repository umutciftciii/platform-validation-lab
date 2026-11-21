import Image from "next/image";

import { type FooterLink, type SiteFooterContent } from "@/content/site-footer";
import { splitLocale } from "@/lib/locale-routing";
import { PRIVACY_PATH, privacyHref, privacyPolicyHref } from "@/lib/privacy";

/**
 * DP-095 D-T5: the policy link of the legal line renders as text where the policy is not
 * published. ML-3: the link arrives with its language prefix (`/en/privacy`) and points at the
 * policy in a language that has one (a Dutch page links the English policy, ADR-028 D12).
 */
function legalLink(link: FooterLink): FooterLink {
  const split = splitLocale(link.href ?? "");
  const isPolicy = link.href === PRIVACY_PATH || split?.rest === PRIVACY_PATH;
  if (!isPolicy) return link;
  if (!privacyHref()) return { ...link, href: null };
  return split ? { ...link, href: privacyPolicyHref(split.locale) } : link;
}

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
          {content.cta === null ? null : content.cta.href === null ? (
            // DP-219: the button's page is not live: text instead of a link that would 404.
            <span className="site-footer-cta" aria-disabled="true">
              {content.cta.label}
              <span className="sr-only"> ({content.pendingNote})</span>
            </span>
          ) : (
            <a href={content.cta.href} className="site-footer-cta" {...newTabProps(content.cta)}>
              {content.cta.label}
              {content.cta.newTab ? <span className="sr-only"> {content.newTab}</span> : null}
            </a>
          )}
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
              {contact.phone.visible ? (
                <p>
                  <a href={contact.phone.href} className="site-footer-link">
                    {contact.phone.label}
                  </a>
                  <span className="site-footer-note">{contact.phone.note}</span>
                </p>
              ) : null}
              {contact.email.visible ? (
                <p>
                  <a href={contact.email.href} className="site-footer-link">
                    {contact.email.label}
                  </a>
                  <span className="site-footer-note">{contact.email.note}</span>
                </p>
              ) : null}
            </address>
            {content.social.length ? (
              // DP-219: social media links from the CMS, as text links in the footer's own style.
              <ul aria-label={content.socialLabel} className="site-footer-social">
                {content.social.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="site-footer-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}
                      <span className="sr-only"> {content.newTab}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <nav aria-label={content.navLabel} className="site-footer-nav">
            {content.columns.map((column) => (
              <div key={column.title} className="site-footer-column">
                <h3 className="site-footer-heading">{column.title}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <FooterItem
                        link={link}
                        pendingNote={content.pendingNote}
                        newTabNote={content.newTab}
                      />
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
                  link={legalLink(link)}
                  pendingNote={content.pendingNote}
                  newTabNote={content.newTab}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function newTabProps(link: FooterLink) {
  return link.newTab ? ({ target: "_blank", rel: "noopener noreferrer" } as const) : {};
}

/** A real link, or plain text when the page does not exist yet. */
function FooterItem({
  link,
  pendingNote,
  newTabNote,
}: {
  link: FooterLink;
  pendingNote: string;
  newTabNote: string;
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
    <a href={link.href} className="site-footer-link" {...newTabProps(link)}>
      {link.label}
      {link.newTab ? <span className="sr-only"> {newTabNote}</span> : null}
    </a>
  );
}
