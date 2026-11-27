/**
 * COM-2b: the corporate home page from the published `corporate.home` (contracts
 * cms-corporate.ts), in the corporate design: hero, company overview, services, product groups,
 * strengths and a call to action. Every text and link is the CMS content; nothing comes from
 * code. The schema has no field for a counter, a distributorship claim or a testimonial, so the
 * page cannot show one. No pictures: the corporate site has no media of its own yet (DP-320).
 */
import type { CorporateHomeContent } from "@dream/contracts";

import { paragraphsOf } from "@/lib/section-view";

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

type Card = CorporateHomeContent["services"]["items"][number];

/** A card whose heading is a link when it has a target (the whole card is the link area). */
function CardHeading({ card }: { card: Card }) {
  return (
    <h3>
      {card.href ? (
        <a className="card-link" href={card.href}>
          {card.title}
        </a>
      ) : (
        card.title
      )}
    </h3>
  );
}

function gridColumns(count: number): 2 | 3 | 4 {
  if (count % 4 === 0) return 4;
  if (count % 3 === 0 || count >= 5) return 3;
  return 2;
}

export function HomePage({ content }: { content: CorporateHomeContent }) {
  const { hero, overview, services, productGroups, strengths, cta } = content;
  return (
    <article>
      <header className="hero hero-home on-dark">
        <div className="container-site">
          {hero.eyebrow ? <p className="eyebrow">{hero.eyebrow}</p> : null}
          <h1>{hero.title}</h1>
          <Paragraphs text={hero.intro} className="hero-intro" />
          <div className="hero-actions">
            <a className="btn btn-accent btn-arrow" href={hero.primary.href}>
              {hero.primary.label}
            </a>
            {hero.secondary ? (
              <a className="btn btn-ghost" href={hero.secondary.href}>
                {hero.secondary.label}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className="section section-plain" aria-labelledby="home-overview">
        <div className="container-site overview">
          <div className="split-head">
            <p className="eyebrow">{overview.eyebrow}</p>
            <h2 id="home-overview" className="section-title overview-title">
              {overview.title}
            </h2>
          </div>
          <div className="overview-body">
            <Paragraphs text={overview.body} className="section-lead" />
            {overview.highlights.length ? (
              <ul className="highlight-list">
                {overview.highlights.map((h) => (
                  <li key={h.title}>
                    <h3>{h.title}</h3>
                    <p>{h.description}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {overview.link ? (
              <p className="m-0">
                <a className="text-link" href={overview.link.href}>
                  {overview.link.label}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section section-tint" aria-labelledby="home-services">
        <div className="container-site">
          <div className="cards-head" data-intro={Boolean(services.intro)}>
            <div className="split-head">
              <p className="eyebrow">{services.eyebrow}</p>
              <h2 id="home-services" className="section-title">
                {services.title}
              </h2>
            </div>
            <Paragraphs text={services.intro} className="section-lead" />
          </div>
          <ol className="service-list">
            {services.items.map((item) => (
              <li key={item.title} className="service-row" data-link={Boolean(item.href)}>
                <CardHeading card={item} />
                {item.description ? <p>{item.description}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section-plain" aria-labelledby="home-products">
        <div className="container-site">
          <div className="cards-head" data-intro={Boolean(productGroups.intro)}>
            <div className="split-head">
              <p className="eyebrow">{productGroups.eyebrow}</p>
              <h2 id="home-products" className="section-title">
                {productGroups.title}
              </h2>
            </div>
            <Paragraphs text={productGroups.intro} className="section-lead" />
          </div>
          <ul className="card-grid" data-columns={gridColumns(productGroups.items.length)}>
            {productGroups.items.map((item) => (
              <li key={item.title}>
                <article className="card" data-link={Boolean(item.href)}>
                  <CardHeading card={item} />
                  {item.description ? <p>{item.description}</p> : null}
                </article>
              </li>
            ))}
          </ul>
          {productGroups.link ? (
            <p className="section-more">
              <a className="btn btn-primary btn-arrow" href={productGroups.link.href}>
                {productGroups.link.label}
              </a>
            </p>
          ) : null}
        </div>
      </section>

      <section className="section strengths on-dark" aria-labelledby="home-strengths">
        <div className="container-site">
          <div className="split-head">
            <p className="eyebrow">{strengths.eyebrow}</p>
            <h2 id="home-strengths" className="section-title">
              {strengths.title}
            </h2>
          </div>
          <ul className="strength-grid">
            {strengths.items.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section-plain">
        <div className="container-site">
          <div className="cta-panel on-dark">
            <div>
              <h2>{cta.title}</h2>
              {cta.text ? <p>{cta.text}</p> : null}
              {cta.points.length ? (
                <ul className="cta-points">
                  {cta.points.map((p) => (
                    <li key={p.text}>{p.text}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <a className="btn btn-accent btn-arrow" href={cta.button.href}>
                {cta.button.label}
              </a>
            </div>
          </div>
        </div>
      </section>
    </article>
  );
}
