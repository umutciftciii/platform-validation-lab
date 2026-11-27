/**
 * COM-2a: the eight section types of the standard template (hero, text, cards, cta, split,
 * specList, quote, contact) in the corporate design. Each renders the published content
 * faithfully and nothing else: no text, figure or claim comes from code.
 *
 * Images (DP-320): a split section shows its image only when it is a registered file of the
 * corporate site (lib/section-view.ts `corporateImage`); otherwise — no image chosen, or another
 * site's file — the section is laid out without one. The corporate site has no registered images
 * until their rights are confirmed, so today every section renders without a picture.
 *
 * Contact: the published contact details (footer) and a map link; COM-4 (DP-030) the contact
 * form (components/contact-form.tsx) where it may be offered (lib/contact-form.ts: the privacy
 * gate of this environment and an offered notice in the page's language), otherwise the form
 * disabled under the section's CMS note — never a form that looks like it works.
 */
import { ContactForm } from "@/components/contact-form";
import type { SiteFooter, TemplateSection } from "@/lib/cms";
import type { ContactSectionForm } from "@/lib/contact-section";
import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { corporateImage, mapHref, paragraphsOf } from "@/lib/section-view";

function Paragraphs({ text, className }: { text: string | null; className?: string }) {
  const list = paragraphsOf(text);
  if (!list.length) return null;
  return (
    <div className={`rich ${className ?? ""}`}>
      {list.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function columnsFor(count: number): 2 | 3 | 4 {
  if (count % 4 === 0 && count >= 4) return 4;
  if (count % 3 === 0 || count >= 5) return 3;
  return 2;
}

/** COM-4: the disabled form under the CMS note (or "not in this language"), nothing to send. */
function DisabledForm({
  id,
  title,
  note,
  labels,
}: {
  id: string;
  title: string;
  note: string;
  labels: ContactSectionForm["labels"] | null;
}) {
  const noteId = `${id}-form-note`;
  return (
    <div className="form-panel">
      <h3>{title}</h3>
      <p id={noteId} role="note">
        {note}
      </p>
      {labels ? (
        // No action and no submit: nothing can be sent from this form.
        <form className="contact-form" aria-describedby={noteId} noValidate>
          <fieldset disabled>
            <legend className="sr-only">{title}</legend>
            {(
              [
                [labels.name, true],
                [labels.email, true],
                [labels.company, true],
                [labels.country, true],
                [labels.phone, false],
                [labels.subject, true],
              ] as const
            ).map(([label, required]) => (
              <label key={label} className="field">
                <span className="field-label">
                  {label}
                  {required ? <span aria-hidden="true"> *</span> : null}
                </span>
                <input disabled />
              </label>
            ))}
            <label className="field field-wide">
              <span className="field-label">
                {labels.message}
                <span aria-hidden="true"> *</span>
              </span>
              <textarea disabled rows={4} />
            </label>
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}

function Section({
  section,
  first,
  contact,
  form,
  locale,
}: {
  section: TemplateSection;
  first: boolean;
  contact: SiteFooter["contact"] | null;
  /** COM-4: the contact form of a contact section (null: the CMS note alone). */
  form: ContactSectionForm | null;
  locale: RouteLocale;
}) {
  const H = first ? "h1" : "h2";
  switch (section.type) {
    case "hero":
      return (
        <header className="hero on-dark">
          <div className="container-site">
            {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
            <H>{section.title}</H>
            <Paragraphs text={section.intro} className="hero-intro" />
            {section.cta ? (
              <div className="hero-actions">
                <a className="btn btn-accent btn-arrow" href={section.cta.href}>
                  {section.cta.label}
                </a>
              </div>
            ) : null}
          </div>
        </header>
      );
    case "text":
      return (
        <section className="section section-plain">
          <div className="container-site text-block" data-titled={Boolean(section.title)}>
            {section.title ? <H className="section-title">{section.title}</H> : null}
            <Paragraphs text={section.body} />
          </div>
        </section>
      );
    case "cards":
      return (
        <section className="section section-tint">
          <div className="container-site">
            {section.title || section.intro ? (
              <div className="cards-head" data-intro={Boolean(section.intro)}>
                {section.title ? <H className="section-title">{section.title}</H> : null}
                <Paragraphs text={section.intro} className="section-lead" />
              </div>
            ) : null}
            <ul className="card-grid" data-columns={columnsFor(section.items.length)}>
              {section.items.map((item) => (
                <li key={item.title}>
                  <article className="card">
                    <h3>{item.title}</h3>
                    {item.description ? <p>{item.description}</p> : null}
                    {item.link ? (
                      <a className="text-link" href={item.link.href}>
                        {item.link.label}
                      </a>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "cta":
      return (
        <section className="section section-plain">
          <div className="container-site">
            <div className="cta-panel on-dark">
              <div>
                <H>{section.title}</H>
                {section.text ? <p>{section.text}</p> : null}
              </div>
              <div>
                <a className="btn btn-accent btn-arrow" href={section.button.href}>
                  {section.button.label}
                </a>
              </div>
            </div>
          </div>
        </section>
      );
    case "split": {
      const image = corporateImage(section.image);
      return (
        <section className="section section-plain">
          <div className="container-site split" data-image={Boolean(image)}>
            <div className="split-head">
              {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
              <H className="section-title">{section.title}</H>
              {image ? <Paragraphs text={section.body} className="split-text" /> : null}
            </div>
            {image ? (
              <figure className="split-figure">
                {/* A registered file of this site with its stored size (no layout shift). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  width={image.width}
                  height={image.height}
                  alt={section.imageAlt ?? ""}
                  loading="lazy"
                  decoding="async"
                />
                {section.imageNote ? <figcaption>{section.imageNote}</figcaption> : null}
              </figure>
            ) : (
              <Paragraphs text={section.body} className="split-text" />
            )}
          </div>
        </section>
      );
    }
    case "specList":
      return (
        <section className="section section-plain">
          <div className="container-site text-block" data-titled="true">
            <div className="split-head">
              <H className="section-title">{section.title}</H>
              <Paragraphs text={section.intro} />
              {section.link ? (
                <p className="m-0">
                  <a className="text-link" href={section.link.href}>
                    {section.link.label}
                  </a>
                </p>
              ) : null}
            </div>
            <dl className="spec-list">
              {section.items.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  {item.detail ? <dd>{item.detail}</dd> : null}
                </div>
              ))}
            </dl>
          </div>
        </section>
      );
    case "quote":
      return (
        <section className="section section-plain">
          <div className="container-site">
            <figure className="quote">
              <blockquote>
                <p className="m-0">{section.text}</p>
              </blockquote>
              {section.source ? <figcaption>{section.source}</figcaption> : null}
            </figure>
          </div>
        </section>
      );
    case "contact": {
      const t = dictionary(locale).contact;
      const map = contact ? mapHref(contact.company, contact.addressLines) : null;
      return (
        <section className="section section-plain">
          <div className="container-site contact-grid">
            <div>
              <H className="section-title">{section.title}</H>
              <Paragraphs text={section.intro} className="section-lead mt-6" />
              {contact ? (
                <dl className="contact-details">
                  {contact.addressLines.length ? (
                    <div>
                      <dt>{t.address}</dt>
                      <dd>
                        <address className="not-italic">
                          {contact.company}
                          {contact.addressLines.map((l) => (
                            <span key={l.text} className="block">
                              {l.text}
                            </span>
                          ))}
                        </address>
                        {map ? (
                          <a
                            className="text-link"
                            href={map}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t.map}
                            <span className="sr-only"> {dictionary(locale).newTab}</span>
                          </a>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{t.phone}</dt>
                    <dd>
                      <a href={contact.phone.href}>{contact.phone.label}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>{t.email}</dt>
                    <dd>
                      <a href={contact.email.href}>{contact.email.label}</a>
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
            {form?.state.kind === "live" ? (
              <ContactForm
                idPrefix={section.id}
                title={section.formTitle}
                countries={form.countries}
                notice={form.state.notice}
                privacyHref={form.privacyHref}
                locale={locale}
                ui={form.labels}
              />
            ) : (
              <DisabledForm
                id={section.id}
                title={section.formTitle}
                // Where the texts may be published but not in this language: say so in it (the
                // CMS note describes the production gate, not a missing translation).
                note={
                  form?.state.kind === "disabled" && form.state.reason === "notInLanguage"
                    ? form.labels.notInLanguage
                    : section.formNote
                }
                labels={form?.labels ?? null}
              />
            )}
          </div>
        </section>
      );
    }
  }
}

export function TemplateSections({
  title,
  sections,
  contact,
  form = null,
  locale,
}: {
  title: string;
  sections: TemplateSection[];
  /** The published contact details (footer) for a contact section; null when not published. */
  contact: SiteFooter["contact"] | null;
  /** COM-4: the contact form of the page's contact section (lib/contact-section.ts). */
  form?: ContactSectionForm | null;
  locale: RouteLocale;
}) {
  // One main heading per page: the first section's heading when it is a hero or a split section
  // (as on BV), else the page title above the sections.
  const leading = sections[0]?.type === "hero" || sections[0]?.type === "split";
  return (
    <article>
      {leading ? null : (
        <header className="page-title">
          <div className="container-site">
            <h1>{title}</h1>
          </div>
        </header>
      )}
      {sections.map((s, i) => (
        <Section
          key={s.id}
          section={s}
          first={leading && i === 0}
          contact={contact}
          form={form}
          locale={locale}
        />
      ))}
    </article>
  );
}

/**
 * COM-3: the body sections of a news article under its own heading (the article title is the
 * page's only main heading, so every section heading is a second-level one).
 */
export function BodySections({
  sections,
  locale,
}: {
  sections: TemplateSection[];
  locale: RouteLocale;
}) {
  return (
    <>
      {sections.map((s) => (
        <Section key={s.id} section={s} first={false} contact={null} form={null} locale={locale} />
      ))}
    </>
  );
}
