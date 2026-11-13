import Image from "next/image";
import Link from "next/link";

import { COUNTRY_CODES, LEAD_CONTACT_NOTICE, cmsAsset } from "@dream/contracts";
import type { ReactNode } from "react";

import { PreviewBanner } from "@/components/home/home-page";
import { ContactForm } from "@/components/template/contact-form";
import { HashScroll } from "@/components/hash-scroll";
import SiteFooter from "@/components/ui/site-footer";
import type { SiteFooterContent } from "@/content/site-footer";
import SiteNav from "@/components/ui/site-nav";
import type { TemplatePageView, TemplateSection } from "@/lib/cms-home";
import { PRIVACY_PATH, sitePrivacy } from "@/lib/privacy";

/**
 * A CMS template page of the BV site (CMS S3, DP-017): the four ready-made section types in the
 * site's design language (ink background, glass text, amber accents, Archivo at 108% width), with
 * the published navigation and footer around them. Server component; the only client script is the fragment scroll.
 */
export function TemplatePage({ view }: { view: TemplatePageView }) {
  return (
    <>
      {view.preview ? <PreviewBanner /> : null}
      {view.nav ? <SiteNav content={view.nav} /> : null}
      <main
        id="top"
        className={view.sections.some((s) => s.type === "contact") ? "tp tp-contact-page" : "tp"}
      >
        {view.sections.map((s, i) => (
          <Section key={s.id} section={s} first={i === 0} contact={view.footer?.contact ?? null} />
        ))}
      </main>
      {view.footer ? <SiteFooter content={view.footer} /> : null}
      <HashScroll />
    </>
  );
}

type ContactDetails = SiteFooterContent["contact"];

function Section({
  section,
  first,
  contact,
}: {
  section: TemplateSection;
  first: boolean;
  contact: ContactDetails | null;
}) {
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
    case "split": {
      const size = cmsAsset(section.image);
      const Heading = first ? "h1" : "h2";
      return (
        <section id={section.id} className={first ? "tp-split tp-split-lead" : "tp-split"}>
          <div className="tp-inner tp-split-grid">
            <div className="tp-split-text">
              {section.eyebrow ? <p className="tp-eyebrow">{section.eyebrow}</p> : null}
              <Heading className={first ? "tp-display" : "tp-title"}>{section.title}</Heading>
              {paragraphs(section.body).map((p, i) => (
                <p key={i} className="tp-lead">
                  {p}
                </p>
              ))}
            </div>
            <figure className="tp-split-figure">
              <Image
                src={section.image}
                alt={section.imageAlt}
                width={size?.width ?? 1448}
                height={size?.height ?? 1086}
                sizes="(min-width: 900px) 56vw, 100vw"
                priority={first}
                className="tp-split-image"
              />
              {section.imageNote ? (
                <figcaption className="tp-split-note">{section.imageNote}</figcaption>
              ) : null}
            </figure>
          </div>
        </section>
      );
    }
    case "specList":
      return (
        <section id={section.id} className="tp-spec">
          <div className="tp-inner tp-spec-grid">
            <div className="tp-spec-head">
              <h2 className="tp-title">{section.title}</h2>
              {section.intro ? <p className="tp-intro">{section.intro}</p> : null}
              {section.link ? (
                <CmsLink href={section.link.href} className="tp-spec-link">
                  {section.link.label}
                </CmsLink>
              ) : null}
            </div>
            <dl className="tp-spec-rows">
              {section.items.map((row, i) => (
                <div key={i} className={row.detail ? "tp-spec-row" : "tp-spec-row tp-spec-row-term"}>
                  <dt className="tp-spec-term">{row.term}</dt>
                  {row.detail ? <dd className="tp-spec-detail">{row.detail}</dd> : null}
                </div>
              ))}
            </dl>
          </div>
        </section>
      );
    case "quote":
      return (
        <section id={section.id} className="tp-quote">
          <div className="tp-inner">
            <figure className="tp-quote-figure">
              <blockquote className="tp-quote-text">{section.text}</blockquote>
              {section.source ? (
                <figcaption className="tp-quote-source">{section.source}</figcaption>
              ) : null}
            </figure>
          </div>
        </section>
      );
    case "contact":
      return <ContactSection section={section} contact={contact} />;
  }
}

/**
 * The form's fields as on the live contact page. Interface text, not content: the form and its
 * fields are defined by DP-151, which also connects it.
 */
const CONTACT_FIELDS = [
  { key: "name", label: "Your name", type: "text", required: true, autoComplete: "name" },
  { key: "email", label: "Your e-mail", type: "email", required: true, autoComplete: "email" },
  { key: "phone", label: "Phone number", type: "tel", required: false, autoComplete: "tel" },
  { key: "subject", label: "Subject", type: "text", required: false, autoComplete: "off" },
] as const;

/** Country names in English, sorted, for the contact form. */
function contactCountries(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
}

/**
 * Contact details (DP-150) next to the contact form. The details are the published footer's
 * (one source for the phone, e-mail and address); without a published footer they are left out.
 * DP-151: the form sends where the privacy texts may be published; elsewhere it is shown
 * disabled, under the CMS note, with no action and no submit.
 */
function ContactSection({
  section,
  contact,
}: {
  section: Extract<TemplateSection, { type: "contact" }>;
  contact: ContactDetails | null;
}) {
  const noteId = `${section.id}-form-note`;
  // DP-151: the working form where the privacy texts may be shown (DP-095 D-T5); elsewhere (in
  // production while they are drafts) the disabled form and the CMS note, never a form that
  // looks like it works.
  const live = sitePrivacy().publish;
  return (
    <section id={section.id} className="tp-contact">
      <div className="tp-inner tp-contact-grid">
        <div className="tp-contact-details">
          <h2 className="tp-title">{section.title}</h2>
          {section.intro ? <p className="tp-intro">{section.intro}</p> : null}
          {contact ? (
            <dl className="tp-spec-rows tp-contact-rows">
              <div className="tp-spec-row tp-contact-row">
                <dt className="tp-contact-label">Phone</dt>
                <dd className="tp-contact-value">
                  <a href={contact.phone.href} className="tp-contact-link">
                    {contact.phone.label}
                  </a>
                  <span className="tp-contact-note">{contact.phone.note}</span>
                </dd>
              </div>
              <div className="tp-spec-row tp-contact-row">
                <dt className="tp-contact-label">E-mail</dt>
                <dd className="tp-contact-value">
                  <a href={contact.email.href} className="tp-contact-link">
                    {contact.email.label}
                  </a>
                  <span className="tp-contact-note">{contact.email.note}</span>
                </dd>
              </div>
              <div className="tp-spec-row tp-contact-row">
                <dt className="tp-contact-label">Office</dt>
                <dd className="tp-contact-value">
                  <address className="tp-contact-address">
                    {contact.company}
                    {contact.addressLines.map((line) => (
                      <span key={line}>
                        <br />
                        {line}
                      </span>
                    ))}
                  </address>
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
        {live ? (
          <ContactForm
            idPrefix={section.id}
            title={section.formTitle}
            countries={contactCountries()}
            notice={{ version: LEAD_CONTACT_NOTICE.version, text: LEAD_CONTACT_NOTICE.text }}
            privacyHref={PRIVACY_PATH}
          />
        ) : (
          <div className="tp-contact-form">
            <h3 className="tp-contact-form-title">{section.formTitle}</h3>
            <p id={noteId} className="tp-contact-form-note" role="note">
              {section.formNote}
            </p>
            {/* No action and no submit: nothing can be sent until DP-151. */}
            <form className="tp-contact-fields" aria-describedby={noteId} noValidate>
              <fieldset disabled className="tp-contact-fieldset">
                <legend className="sr-only">{section.formTitle}</legend>
                {CONTACT_FIELDS.map((f) => (
                  <label key={f.key} className="tp-contact-field">
                    <span className="tp-contact-field-label">
                      {f.label}
                      {f.required ? <span aria-hidden="true"> *</span> : null}
                    </span>
                    <input
                      type={f.type}
                      name={f.key}
                      autoComplete={f.autoComplete}
                      className="tp-contact-input"
                    />
                  </label>
                ))}
                <label className="tp-contact-field tp-contact-field-wide">
                  <span className="tp-contact-field-label">
                    Your message<span aria-hidden="true"> *</span>
                  </span>
                  <textarea name="message" rows={5} className="tp-contact-input" />
                </label>
                <button type="button" className="tp-button tp-contact-submit" disabled>
                  Not available yet
                </button>
              </fieldset>
            </form>
          </div>
        )}
      </div>
    </section>
  );
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
