/**
 * COM-2b / COM-7: the corporate home page from the published `corporate.home` (contracts
 * cms-corporate.ts) in the COM-7 design: the activity-area opening (components/hero-stage.tsx),
 * picture cards of the services, the company overview with the activity areas, the product
 * portfolio, the strengths, the latest articles of the news model and the call to action. Every
 * text, link and picture is CMS content (pictures: registered corporate files, representative
 * scenes); only list labels and dates are interface texts. No field exists for a counter, a
 * distributorship claim or a testimonial, so the page cannot show one.
 *
 * Content stored before COM-7 (no areas, no pictures, no news heading) still renders: the opening
 * becomes a plain heading, cards without a picture are navy, the news block is left out.
 */
import type { CmsPublicArticle, CorporateHomeContent } from "@dream/contracts";

import { HeroStage, type StageSlide } from "@/components/hero-stage";
import { Picture } from "@/components/picture";
import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { formatNewsDate } from "@/lib/news-view";
import { corporateImage, paragraphsOf } from "@/lib/section-view";

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

const num = (i: number) => String(i + 1).padStart(2, "0");

function Opening({ hero, locale }: { hero: CorporateHomeContent["hero"]; locale: RouteLocale }) {
  const slides: StageSlide[] = (hero.slides ?? []).flatMap((s) => {
    const image = corporateImage(s.image);
    return image
      ? [
          {
            label: s.label,
            title: s.title,
            intro: s.intro,
            image: { src: image.src, width: image.width, height: image.height },
            imageAlt: s.imageAlt,
            cta: s.cta,
          },
        ]
      : [];
  });
  if (slides.length) {
    const t = dictionary(locale).home;
    return (
      <HeroStage
        eyebrow={hero.eyebrow}
        title={hero.title}
        intro={hero.intro}
        primary={hero.primary}
        slides={slides}
        labels={{ areas: t.areas, areaOf: t.areaOf }}
      />
    );
  }
  // Content stored before COM-7: the heading on the navy ground.
  return (
    <header className="page-hero page-hero-plain on-dark">
      <div className="container-site page-hero-inner">
        {hero.eyebrow ? <p className="eyebrow">{hero.eyebrow}</p> : null}
        <h1 className="page-hero-title">{hero.title}</h1>
        <Paragraphs text={hero.intro} className="page-hero-intro" />
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
  );
}

function SectionHead({
  id,
  eyebrow,
  title,
  intro,
}: {
  id: string;
  eyebrow: string | null;
  title: string;
  intro?: string | null;
}) {
  return (
    <div className="block-head" data-intro={Boolean(intro)}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="block-title">
          {title}
        </h2>
      </div>
      <Paragraphs text={intro ?? null} className="block-lead" />
    </div>
  );
}

export function HomePage({
  content,
  articles = [],
  locale,
}: {
  content: CorporateHomeContent;
  /** The newest published articles of the language (at most three are shown). */
  articles?: readonly CmsPublicArticle[];
  locale: RouteLocale;
}) {
  const { hero, overview, services, productGroups, strengths, cta } = content;
  const news = content.news ?? null;
  const latest = articles.slice(0, 3);
  const t = dictionary(locale);
  const areas = hero.slides ?? [];
  return (
    <article className="home">
      <Opening hero={hero} locale={locale} />

      {/* Services: picture cards, the whole card is the link. */}
      <section className="band" aria-labelledby="home-services">
        <div className="container-site">
          <SectionHead
            id="home-services"
            eyebrow={services.eyebrow}
            title={services.title}
            intro={services.intro}
          />
          <ul className="svc-grid" data-count={services.items.length}>
            {services.items.map((item, i) => (
              <li key={item.title}>
                <article
                  className="svc-card"
                  data-image={Boolean(corporateImage(item.image))}
                  data-link={Boolean(item.href)}
                >
                  <Picture
                    src={item.image}
                    alt={item.imageAlt}
                    className="svc-image"
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  />
                  <span aria-hidden className="svc-shade" />
                  <span className="svc-num" aria-hidden>
                    {num(i)}
                  </span>
                  <div className="svc-body">
                    <h3 className="svc-title">
                      {item.href ? (
                        <a className="card-link" href={item.href}>
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h3>
                    {item.description ? <p className="svc-text">{item.description}</p> : null}
                  </div>
                  {item.href ? (
                    <span aria-hidden className="svc-arrow">
                      →
                    </span>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Company overview and the activity areas. */}
      <section className="band band-mist" aria-labelledby="home-overview">
        <div className="container-site overview-grid">
          <div>
            <p className="eyebrow">{overview.eyebrow}</p>
            <h2 id="home-overview" className="statement">
              {overview.title}
            </h2>
          </div>
          <div className="overview-side">
            <Paragraphs text={overview.body} className="block-lead" />
            {overview.highlights.length ? (
              <ul className="facts">
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
        {areas.length ? (
          <div className="container-site">
            <ol className="area-rows" aria-label={t.home.areas}>
              {areas.map((a, i) => (
                <li key={a.label + i} className="area-row" data-link={Boolean(a.cta)}>
                  <span className="area-num" aria-hidden>
                    {num(i)}
                  </span>
                  <span className="area-label">
                    {a.cta ? (
                      <a className="card-link" href={a.cta.href}>
                        {a.label}
                      </a>
                    ) : (
                      a.label
                    )}
                  </span>
                  <span className="area-title">{a.intro}</span>
                  <span aria-hidden className="area-arrow">
                    →
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {/* Product portfolio. */}
      <section className="band" aria-labelledby="home-products">
        <div className="container-site portfolio-grid">
          <div className="portfolio-head">
            <p className="eyebrow">{productGroups.eyebrow}</p>
            <h2 id="home-products" className="block-title">
              {productGroups.title}
            </h2>
            <Paragraphs text={productGroups.intro} className="block-lead" />
            {productGroups.link ? (
              <p className="portfolio-more">
                <a className="btn btn-primary btn-arrow" href={productGroups.link.href}>
                  {productGroups.link.label}
                </a>
              </p>
            ) : null}
          </div>
          <ol className="group-cards">
            {productGroups.items.map((item, i) => (
              <li key={item.title}>
                <article className="group-card" data-link={Boolean(item.href)}>
                  <span className="group-num" aria-hidden>
                    {num(i)}
                  </span>
                  <h3>
                    {item.href ? (
                      <a className="card-link" href={item.href}>
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>
                  {item.description ? <p>{item.description}</p> : null}
                  {item.href ? (
                    <span aria-hidden className="group-arrow">
                      →
                    </span>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why Dream Petroleum. */}
      <section className="band band-navy on-dark" aria-labelledby="home-strengths">
        <div className="container-site">
          <SectionHead id="home-strengths" eyebrow={strengths.eyebrow} title={strengths.title} />
          <ol className="strength-cols" data-count={strengths.items.length}>
            {strengths.items.map((item, i) => (
              <li key={item.title}>
                <span className="strength-num" aria-hidden>
                  {num(i)}
                </span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* News & insights: the newest articles of the news model. */}
      {news?.title && latest.length ? (
        <section className="band" aria-labelledby="home-news">
          <div className="container-site">
            <div className="block-head block-head-row">
              <div>
                {news.eyebrow ? <p className="eyebrow">{news.eyebrow}</p> : null}
                <h2 id="home-news" className="block-title">
                  {news.title}
                </h2>
              </div>
              {news.link ? (
                <a className="btn btn-outline btn-arrow" href={news.link.href}>
                  {news.link.label}
                </a>
              ) : null}
            </div>
            <ol className="post-grid" aria-label={t.home.latest}>
              {latest.map((a, i) => (
                <li key={a.path}>
                  <article className="post-card" data-featured={i === 0}>
                    <time className="post-date" dateTime={a.firstPublishedAt}>
                      {formatNewsDate(locale, a.firstPublishedAt)}
                    </time>
                    <h3 className="post-title">
                      <a className="card-link" href={a.path}>
                        {a.title}
                      </a>
                    </h3>
                    <p className="post-excerpt">{a.excerpt}</p>
                    <span aria-hidden className="post-more">
                      {t.news.readMore} →
                    </span>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {/* Call to action. */}
      <section className="band band-tight" aria-labelledby="home-cta">
        <div className="container-site">
          <div className="cta-split on-dark" data-image={Boolean(corporateImage(cta.image))}>
            <div className="cta-split-copy">
              <h2 id="home-cta" className="block-title">
                {cta.title}
              </h2>
              {cta.text ? <p className="cta-split-text">{cta.text}</p> : null}
              {cta.points.length ? (
                <ul className="tick-list">
                  {cta.points.map((p) => (
                    <li key={p.text}>{p.text}</li>
                  ))}
                </ul>
              ) : null}
              <p className="m-0">
                <a className="btn btn-accent btn-arrow" href={cta.button.href}>
                  {cta.button.label}
                </a>
              </p>
            </div>
            <Picture
              src={cta.image}
              alt={cta.imageAlt}
              className="cta-split-image"
              sizes="(min-width: 1024px) 40vw, 100vw"
            />
          </div>
        </div>
      </section>
    </article>
  );
}
