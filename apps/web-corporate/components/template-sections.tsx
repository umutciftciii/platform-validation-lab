/**
 * COM-2a: the eight section types of the standard template (hero, text, cards, cta, split,
 * specList, quote, contact) in the corporate design. Each renders the published content
 * faithfully and nothing else: no text, figure or claim comes from code.
 *
 * Images (DP-320): a split section shows its image only when it is a registered file of the
 * corporate site (lib/section-view.ts `corporateImage`); otherwise — no image chosen, or another
 * site's file — the section is laid out without one. COM-7: a hero may carry one of the visual
 * pack's pictures (representative scenes) and then opens the page full width under a transparent
 * header; without one it is a navy heading. The same section types take different compositions
 * by their content and place (a titled text is a two-column pair, an untitled one a lead; card
 * sections alternate their ground; a hero further down is a navy interlude), so pages built from
 * the same types do not look alike.
 *
 * Contact: the published contact details (footer) and a map link; COM-4 (DP-030) the contact
 * form (components/contact-form.tsx) where it may be offered (lib/contact-form.ts: the privacy
 * gate of this environment and an offered notice in the page's language), otherwise the form
 * disabled under the section's CMS note — never a form that looks like it works.
 */
import { ContactForm } from "@/components/contact-form";
import { Picture } from "@/components/picture";
import type { SiteFooter, TemplateSection } from "@/lib/cms";
import type { ContactSectionForm } from "@/lib/contact-section";
import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { corporateImage, mapHref, paragraphsOf, textBlocks } from "@/lib/section-view";

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

/** COM-7: a card's text with the live site's "• " lines as a real list. */
function CardText({ text }: { text: string | null }) {
  const blocks = textBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="feature-text">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="dash-list">
            {b.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const num = (i: number) => String(i + 1).padStart(2, "0");

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
  place,
  contact,
  form,
  locale,
}: {
  section: TemplateSection;
  first: boolean;
  /** COM-7: the how-manieth section of its type on the page (0-based), for alternating grounds. */
  place: number;
  contact: SiteFooter["contact"] | null;
  /** COM-4: the contact form of a contact section (null: the CMS note alone). */
  form: ContactSectionForm | null;
  locale: RouteLocale;
}) {
  const H = first ? "h1" : "h2";
  switch (section.type) {
    case "hero": {
      const picture = corporateImage(section.image);
      if (!first) {
        // A hero further down the page (e.g. Our Team's second part): a navy interlude.
        return (
          <section className="interlude on-dark">
            <div className="container-site interlude-inner">
              {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
              <H className="interlude-title">{section.title}</H>
              <Paragraphs text={section.intro} className="interlude-intro" />
              {section.cta ? (
                <p className="m-0">
                  <a className="btn btn-accent btn-arrow" href={section.cta.href}>
                    {section.cta.label}
                  </a>
                </p>
              ) : null}
            </div>
          </section>
        );
      }
      return (
        <header
          className={`page-hero on-dark ${picture ? "page-hero-picture" : "page-hero-plain"}`}
        >
          {picture ? (
            <div className="page-hero-media">
              <Picture
                src={section.image}
                alt={section.imageAlt}
                className="page-hero-image"
                sizes="100vw"
                eager
              />
              <span aria-hidden className="page-hero-shade" />
            </div>
          ) : null}
          <div className="container-site page-hero-inner">
            {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
            <H className="page-hero-title">{section.title}</H>
            <Paragraphs text={section.intro} className="page-hero-intro" />
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
    }
    case "text":
      return section.title ? (
        <section className="band text-pair-block">
          <div className="container-site text-pair">
            <H className="text-pair-title">{section.title}</H>
            <Paragraphs text={section.body} className="text-pair-body" />
          </div>
        </section>
      ) : (
        <section className="band lead-block">
          <div className="container-site">
            <Paragraphs text={section.body} className="lead-text" />
          </div>
        </section>
      );
    case "cards": {
      const columns = columnsFor(section.items.length);
      // Card sections alternate: mist, white with rules, mist...; a single card is a statement.
      const ground = place % 2 === 0 ? "band-mist" : "band-ruled";
      return (
        <section className={`band ${ground}`}>
          <div className="container-site">
            {section.title || section.intro ? (
              <div className="block-head" data-intro={Boolean(section.intro)}>
                {section.title ? <H className="block-title">{section.title}</H> : <span />}
                <Paragraphs text={section.intro} className="block-lead" />
              </div>
            ) : null}
            <ol className="feature-grid" data-columns={columns} data-count={section.items.length}>
              {section.items.map((item, i) => (
                <li key={item.title}>
                  <article className="feature-card">
                    <span className="feature-num" aria-hidden>
                      {num(i)}
                    </span>
                    <h3 className="feature-title">{item.title}</h3>
                    <CardText text={item.description} />
                    {item.link ? (
                      <a className="text-link" href={item.link.href}>
                        {item.link.label}
                      </a>
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>
      );
    }
    case "cta":
      return (
        <section className="band band-tight">
          <div className="container-site">
            <div className="cta-band on-dark">
              <div>
                <H className="cta-band-title">{section.title}</H>
                {section.text ? <p className="cta-band-text">{section.text}</p> : null}
              </div>
              <a className="btn btn-accent btn-arrow" href={section.button.href}>
                {section.button.label}
              </a>
            </div>
          </div>
        </section>
      );
    case "split": {
      const image = corporateImage(section.image);
      return (
        <section className="band">
          <div className="container-site split" data-image={Boolean(image)}>
            <div className="split-head">
              {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
              <H className="block-title">{section.title}</H>
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
        <section className="band">
          <div className="container-site text-block" data-titled="true">
            <div className="split-head">
              <H className="block-title">{section.title}</H>
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
        <section className="band">
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
        <section className="band band-mist contact-block">
          <div className="container-site contact-grid">
            <div>
              <H className="block-title">{section.title}</H>
              <Paragraphs text={section.intro} className="block-lead mt-6" />
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
            <h1 className="page-title-heading">{title}</h1>
          </div>
        </header>
      )}
      {sections.map((s, i) => (
        <Section
          key={s.id}
          section={s}
          first={leading && i === 0}
          place={sections.slice(0, i).filter((x) => x.type === s.type).length}
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
        <Section
          key={s.id}
          section={s}
          first={false}
          place={0}
          contact={null}
          form={null}
          locale={locale}
        />
      ))}
    </>
  );
}
