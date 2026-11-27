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
 * Contact: the published contact details (footer) and a map link; the form is COM-4 (DP-030), so
 * the panel shows the section's form heading and its note.
 */
import type { SiteFooter, TemplateSection } from "@/lib/cms";
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

function Section({
  section,
  first,
  contact,
  locale,
}: {
  section: TemplateSection;
  first: boolean;
  contact: SiteFooter["contact"] | null;
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
            <div className="form-panel">
              <h3>{section.formTitle}</h3>
              <p>{section.formNote}</p>
            </div>
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
  locale,
}: {
  title: string;
  sections: TemplateSection[];
  /** The published contact details (footer) for a contact section; null when not published. */
  contact: SiteFooter["contact"] | null;
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
          locale={locale}
        />
      ))}
    </article>
  );
}
