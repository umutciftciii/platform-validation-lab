import Link from "next/link";
import type { ReactNode } from "react";

import { PreviewBanner } from "@/components/home/home-page";
import SiteFooter from "@/components/ui/site-footer";
import SiteNav from "@/components/ui/site-nav";
import type { TemplatePageView, TemplateSection } from "@/lib/cms-home";

/**
 * A CMS template page of the BV site (CMS S3, DP-017): the four ready-made section types in the
 * site's design language (ink background, glass text, amber accents, Archivo at 108% width), with
 * the published navigation and footer around them. Server component; no client script.
 */
export function TemplatePage({ view }: { view: TemplatePageView }) {
  return (
    <>
      {view.preview ? <PreviewBanner /> : null}
      {view.nav ? <SiteNav content={view.nav} /> : null}
      <main id="top" className="tp">
        {view.sections.map((s, i) => (
          <Section key={s.id} section={s} first={i === 0} />
        ))}
      </main>
      {view.footer ? <SiteFooter content={view.footer} /> : null}
    </>
  );
}

function Section({ section, first }: { section: TemplateSection; first: boolean }) {
  switch (section.type) {
    case "hero":
      return (
        <section id={section.id} className="tp-hero">
          <div className="tp-inner">
            {section.eyebrow ? <p className="tp-eyebrow">{section.eyebrow}</p> : null}
            {first ? <h1 className="tp-display">{section.title}</h1> : <h2 className="tp-display">{section.title}</h2>}
            {section.intro ? <p className="tp-lead">{section.intro}</p> : null}
            {section.cta ? (
              <CmsLink href={section.cta.href} className="tp-button">
                {section.cta.label}
              </CmsLink>
            ) : null}
          </div>
        </section>
      );
    case "text":
      return (
        <section id={section.id} className="tp-text">
          <div className="tp-inner">
            <div className="tp-measure">
              {section.title ? <h2 className="tp-title">{section.title}</h2> : null}
              {paragraphs(section.body).map((p, i) => (
                <p key={i} className="tp-body">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>
      );
    case "cards":
      return (
        <section id={section.id} className="tp-cards">
          <div className="tp-inner">
            {section.title ? <h2 className="tp-title">{section.title}</h2> : null}
            {section.intro ? <p className="tp-intro">{section.intro}</p> : null}
            <ul className="tp-card-grid">
              {section.items.map((card, i) => (
                <li key={i} className="tp-card">
                  <h3 className="tp-card-title">{card.title}</h3>
                  {card.description ? <p className="tp-card-text">{card.description}</p> : null}
                  {card.link ? (
                    <CmsLink href={card.link.href} className="tp-card-link">
                      {card.link.label} <span aria-hidden="true">→</span>
                    </CmsLink>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "cta":
      return (
        <section id={section.id} className="tp-cta">
          <div className="tp-inner">
            <div className="tp-cta-inner">
              <div>
                <h2 className="tp-cta-title">{section.title}</h2>
                {section.text ? <p className="tp-intro">{section.text}</p> : null}
              </div>
              <CmsLink href={section.button.href} className="tp-button tp-button-outline">
                {section.button.label}
              </CmsLink>
            </div>
          </div>
        </section>
      );
  }
}

/** A blank line starts a new paragraph (the admin's body field says so). */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Site paths use client navigation; anchors, https, mailto and tel are plain links. */
function CmsLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
