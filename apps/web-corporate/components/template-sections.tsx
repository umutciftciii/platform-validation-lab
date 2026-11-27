/**
 * COM-1: the sections of a corporate CMS content page (the standard template's section types), as
 * semantic HTML. The site's visual design comes with COM-2; this renders the published content
 * faithfully and nothing else.
 *
 * Images: the registered static assets (CMS_STATIC_ASSETS) are files of the BV site, which the
 * corporate site does not serve; an image is therefore not shown here (its text is), until the
 * corporate media come with COM-2/COM-5. A contact section shows its texts; its form is COM-4.
 */
import type { TemplateSection } from "@/lib/cms";

function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => <p key={i}>{p}</p>);
}

function Section({ section }: { section: TemplateSection }) {
  switch (section.type) {
    case "hero":
      return (
        <header className="section hero">
          {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
          <h1>{section.title}</h1>
          {section.intro ? paragraphs(section.intro) : null}
          {section.cta ? (
            <a className="button" href={section.cta.href}>
              {section.cta.label}
            </a>
          ) : null}
        </header>
      );
    case "text":
      return (
        <section className="section text">
          {section.title ? <h2>{section.title}</h2> : null}
          {paragraphs(section.body)}
        </section>
      );
    case "cards":
      return (
        <section className="section cards">
          {section.title ? <h2>{section.title}</h2> : null}
          {section.intro ? paragraphs(section.intro) : null}
          <ul>
            {section.items.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
                {item.link ? <a href={item.link.href}>{item.link.label}</a> : null}
              </li>
            ))}
          </ul>
        </section>
      );
    case "cta":
      return (
        <section className="section cta">
          <h2>{section.title}</h2>
          {section.text ? <p>{section.text}</p> : null}
          <a className="button" href={section.button.href}>
            {section.button.label}
          </a>
        </section>
      );
    case "split":
      return (
        <section className="section split">
          {section.eyebrow ? <p className="eyebrow">{section.eyebrow}</p> : null}
          <h2>{section.title}</h2>
          {paragraphs(section.body)}
        </section>
      );
    case "specList":
      return (
        <section className="section spec-list">
          <h2>{section.title}</h2>
          {section.intro ? paragraphs(section.intro) : null}
          <dl>
            {section.items.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                {item.detail ? <dd>{item.detail}</dd> : null}
              </div>
            ))}
          </dl>
          {section.link ? <a href={section.link.href}>{section.link.label}</a> : null}
        </section>
      );
    case "quote":
      return (
        <figure className="section quote">
          <blockquote>{section.text}</blockquote>
          {section.source ? <figcaption>{section.source}</figcaption> : null}
        </figure>
      );
    case "contact":
      return (
        <section className="section contact">
          <h2>{section.title}</h2>
          {section.intro ? paragraphs(section.intro) : null}
        </section>
      );
  }
}

export function TemplateSections({
  title,
  sections,
}: {
  title: string;
  sections: TemplateSection[];
}) {
  // A page without a hero section still has one main heading: its title.
  const hasHero = sections.some((s) => s.type === "hero");
  return (
    <article className="page">
      {hasHero ? null : <h1>{title}</h1>}
      {sections.map((s) => (
        <Section key={s.id} section={s} />
      ))}
    </article>
  );
}
