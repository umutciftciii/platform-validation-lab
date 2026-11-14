import Image from "next/image";
import Link from "next/link";

import { cmsAsset, type CmsPublicArticle } from "@dream/contracts";

import { PreviewBanner } from "@/components/home/home-page";
import { HashScroll } from "@/components/hash-scroll";
import { Section } from "@/components/template/template-page";
import SiteFooter from "@/components/ui/site-footer";
import SiteNav from "@/components/ui/site-nav";
import type { SiteFooterContent } from "@/content/site-footer";
import type { SiteNavContent } from "@/content/site-nav";
import type { ArticleView, NewsView } from "@/lib/cms-home";

/**
 * DP-020: the news list (/news) and article (/news/<slug>) pages of the BV site, in the language
 * of the CMS template pages (ink ground, glass type, amber accents, Archivo 108%). Server
 * components; every word of an article and of the list heading comes from the CMS (DP-153:
 * `bv.news-index`), the interface labels below are code.
 */
export const NEWS_UI = {
  eyebrow: "News",
  readMore: "Read article",
  back: "All news",
  removed: {
    title: "This article is no longer available",
    text: "It has been taken off the site. You can find our current articles on the news page.",
  },
} as const;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

function Shell({
  nav,
  footer,
  preview = false,
  children,
}: {
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  preview?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {preview ? <PreviewBanner /> : null}
      {nav ? <SiteNav content={nav} /> : null}
      <main id="top" className="tp news">
        {children}
      </main>
      {footer ? <SiteFooter content={footer} /> : null}
      <HashScroll />
    </>
  );
}

function Cover({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className: string;
}) {
  const size = cmsAsset(src);
  return (
    <Image
      src={src}
      alt={alt}
      width={size?.width ?? 1448}
      height={size?.height ?? 1086}
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}

/**
 * /news: the published articles, newest first by their first publication, under the heading of the
 * published `bv.news-index` page (or its draft in a preview).
 */
export function NewsList({ view }: { view: NewsView }) {
  const copy = view.heading.copy;
  return (
    <Shell nav={view.nav} footer={view.footer} preview={view.preview}>
      <header className="tp-hero news-head">
        <div className="tp-inner">
          <p className="tp-eyebrow">{copy.eyebrow}</p>
          <h1 className="tp-display">{copy.title}</h1>
          <p className="tp-lead">{copy.intro}</p>
        </div>
      </header>
      <section className="news-list" aria-label="Articles">
        <div className="tp-inner">
          {view.articles.length === 0 ? (
            <div className="news-empty" role="status">
              <h2 className="tp-title">{copy.empty.title}</h2>
              <p className="tp-intro">{copy.empty.text}</p>
            </div>
          ) : (
            <ol className="news-grid">
              {view.articles.map((a, i) => (
                <ArticleCard key={a.path} article={a} lead={i === 0} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </Shell>
  );
}

function ArticleCard({ article, lead }: { article: CmsPublicArticle; lead: boolean }) {
  const titleId = `news-${article.slug}`;
  return (
    <li className={lead ? "news-card news-card-lead" : "news-card"}>
      <article aria-labelledby={titleId} className="news-card-body">
        {article.coverImage ? (
          <div className="news-card-media">
            <Cover
              src={article.coverImage}
              alt={article.coverAlt ?? ""}
              sizes={lead ? "(min-width: 900px) 60vw, 100vw" : "(min-width: 900px) 33vw, 100vw"}
              priority={lead}
              className="news-card-image"
            />
          </div>
        ) : null}
        <div className="news-card-text">
          <time dateTime={article.firstPublishedAt} className="news-date">
            {DATE.format(new Date(article.firstPublishedAt))}
          </time>
          <h2 id={titleId} className="news-card-title">
            <Link href={article.path} className="news-card-link">
              {article.title}
            </Link>
          </h2>
          <p className="news-card-excerpt">{article.excerpt}</p>
          <span className="news-card-more" aria-hidden="true">
            {NEWS_UI.readMore} →
          </span>
        </div>
      </article>
    </li>
  );
}

/** /news/<slug>: the article's header, cover and body sections. */
export function ArticlePage({ view }: { view: ArticleView }) {
  return (
    <Shell nav={view.nav} footer={view.footer} preview={view.preview}>
      <article className="news-article">
        <header className="news-article-head">
          <div className="tp-inner">
            <div className="tp-measure">
              <Link href="/news" className="news-back">
                <span aria-hidden="true">←</span> {NEWS_UI.back}
              </Link>
              {view.firstPublishedAt ? (
                <p className="news-date">
                  <time dateTime={view.firstPublishedAt}>
                    {DATE.format(new Date(view.firstPublishedAt))}
                  </time>
                </p>
              ) : (
                <p className="news-date">Not published yet</p>
              )}
              <h1 className="tp-display news-article-title">{view.title}</h1>
              <p className="tp-lead">{view.excerpt}</p>
            </div>
          </div>
        </header>
        {view.coverImage ? (
          <figure className="news-article-cover">
            <div className="tp-inner">
              <Cover
                src={view.coverImage}
                alt={view.coverAlt ?? ""}
                sizes="(min-width: 1152px) 72rem, 100vw"
                priority
                className="news-article-image"
              />
            </div>
          </figure>
        ) : null}
        <div className="news-article-body">
          {view.sections.map((s) => (
            <Section key={s.id} section={s} first={false} contact={null} />
          ))}
        </div>
      </article>
    </Shell>
  );
}

/** An article that was published here and has been taken off the site. */
export function ArticleRemoved({
  nav,
  footer,
}: {
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
}) {
  return (
    <Shell nav={nav} footer={footer}>
      <div className="tp-hero news-removed" role="status">
        <div className="tp-inner">
          <p className="tp-eyebrow">{NEWS_UI.eyebrow}</p>
          <h1 className="tp-display">{NEWS_UI.removed.title}</h1>
          <p className="tp-lead">{NEWS_UI.removed.text}</p>
          <Link href="/news" className="tp-button news-removed-link">
            {NEWS_UI.back}
          </Link>
        </div>
      </div>
    </Shell>
  );
}
