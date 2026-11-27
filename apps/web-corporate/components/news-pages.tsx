/**
 * COM-3: the corporate news list (`/<l>/news`) and article (`/<l>/news/<slug>`) in the corporate
 * design: the list heading, eyebrow and empty state are the published `corporate.news-index`;
 * each card shows the article's first publication date, title and summary (and its cover only
 * when it is a registered file of this site, DP-320 — none today); the article page its date,
 * title, summary, cover and body sections. Every word of the content comes from the CMS; only the
 * interface labels (dates, pages, back link) come from lib/i18n.
 */
import type { CmsPublicArticle } from "@dream/contracts";

import { BodySections } from "@/components/template-sections";
import type { ArticleView, NewsHeading } from "@/lib/cms";
import { dictionary, interpolate } from "@/lib/i18n";
import { localePath, type RouteLocale } from "@/lib/locale-routing";
import { formatNewsDate, newsPageHref, type NewsPage } from "@/lib/news-view";
import { corporateImage, paragraphsOf } from "@/lib/section-view";

function Cover({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string | null;
  alt: string | null;
  className: string;
  eager?: boolean;
}) {
  const image = corporateImage(src);
  if (!image) return null;
  return (
    /* A registered file of this site with its stored size (no layout shift). */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt ?? ""}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

function ArticleCard({ article, locale }: { article: CmsPublicArticle; locale: RouteLocale }) {
  const t = dictionary(locale).news;
  const titleId = `news-${article.slug}`;
  const hasCover = Boolean(corporateImage(article.coverImage));
  return (
    <li>
      <article className="card news-card" data-link="true" aria-labelledby={titleId}>
        {hasCover ? (
          <Cover src={article.coverImage} alt={article.coverAlt} className="news-card-image" />
        ) : null}
        <time className="news-date" dateTime={article.firstPublishedAt}>
          {formatNewsDate(locale, article.firstPublishedAt)}
        </time>
        <h2 id={titleId} className="news-card-title">
          <a className="card-link" href={article.path}>
            {article.title}
          </a>
        </h2>
        <p>{article.excerpt}</p>
        <span className="news-more" aria-hidden="true">
          {t.readMore}
        </span>
      </article>
    </li>
  );
}

function Pagination({
  page,
  pages,
  listHref,
  locale,
}: {
  page: number;
  pages: number;
  listHref: string;
  locale: RouteLocale;
}) {
  if (pages <= 1) return null;
  const t = dictionary(locale).news;
  return (
    <nav className="news-pagination" aria-label={t.pagination}>
      {page > 1 ? (
        <a className="btn btn-ghost-dark" href={newsPageHref(listHref, page - 1)} rel="prev">
          ← {t.previous}
        </a>
      ) : (
        <span />
      )}
      <p className="m-0" aria-current="page">
        {interpolate(t.pageOf, { page: String(page), pages: String(pages) })}
      </p>
      {page < pages ? (
        <a className="btn btn-ghost-dark" href={newsPageHref(listHref, page + 1)} rel="next">
          {t.next} →
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** `/<l>/news`: one page of the published articles under the list heading. */
export function NewsList({
  heading,
  list,
  locale,
}: {
  heading: NewsHeading;
  list: NewsPage<CmsPublicArticle>;
  locale: RouteLocale;
}) {
  const { copy } = heading;
  const t = dictionary(locale).news;
  return (
    <article>
      <header className="hero hero-compact on-dark news-hero">
        <div className="container-site">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <div className="rich hero-intro">
            {paragraphsOf(copy.intro).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </header>
      <section className="section section-plain" aria-label={t.listLabel}>
        <div className="container-site">
          {list.items.length === 0 ? (
            <div className="news-empty" role="status">
              <h2 className="section-title">{copy.empty.title}</h2>
              <p className="section-lead">{copy.empty.text}</p>
            </div>
          ) : (
            <ol className="card-grid news-grid" data-columns="3">
              {list.items.map((a) => (
                <ArticleCard key={a.path} article={a} locale={locale} />
              ))}
            </ol>
          )}
          <Pagination
            page={list.page}
            pages={list.pages}
            listHref={localePath(locale, "/news")}
            locale={locale}
          />
        </div>
      </section>
    </article>
  );
}

/** `/<l>/news/<slug>`: the article's heading, cover and body sections. */
export function ArticlePage({ view }: { view: ArticleView }) {
  const t = dictionary(view.locale).news;
  return (
    <article className="news-article">
      <header className="page-title news-article-head">
        <div className="container-site">
          <div className="prose-width">
            <a className="news-back text-link" href={localePath(view.locale, "/news")}>
              ← {t.back}
            </a>
            <p className="news-date">
              {view.firstPublishedAt ? (
                <time dateTime={view.firstPublishedAt}>
                  {formatNewsDate(view.locale, view.firstPublishedAt)}
                </time>
              ) : (
                t.notPublishedYet
              )}
            </p>
            <h1>{view.title}</h1>
            <p className="section-lead news-excerpt">{view.excerpt}</p>
          </div>
        </div>
      </header>
      {corporateImage(view.coverImage) ? (
        <figure className="container-site news-cover">
          <Cover src={view.coverImage} alt={view.coverAlt} className="news-cover-image" eager />
        </figure>
      ) : null}
      <div className="news-body">
        <BodySections sections={view.sections} locale={view.locale} />
      </div>
    </article>
  );
}

/** An article that was published here and has been taken off the site (noindex). */
export function ArticleRemoved({ locale }: { locale: RouteLocale }) {
  const t = dictionary(locale).news;
  return (
    <div className="container-site section" role="status">
      <div className="prose-width">
        <h1 className="section-title">{t.removedTitle}</h1>
        <p className="section-lead mt-6">{t.removedText}</p>
        <p className="mt-8">
          <a className="btn btn-accent btn-arrow" href={localePath(locale, "/news")}>
            {t.back}
          </a>
        </p>
      </div>
    </div>
  );
}
