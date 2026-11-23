import type { Metadata } from "next";
import Link from "next/link";
import {
  CmsContextResponseSchema,
  CmsPageListResponseSchema,
  cmsIsArticle,
  type CmsPageSummary,
} from "@dream/contracts";
import { ContentTabs } from "../../../../components/cms/content-tabs";
import { LanguageTabs } from "../../../../components/cms/language-tabs";
import { pickCmsSite, publicationState } from "../../../../components/cms/parts";
import { PageHeader, SiteSwitcher } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import { buttonStyles, EmptyState, ErrorState, Panel, StatusPill } from "../../../../components/ui";
import { ADMIN_TIME_ZONE, INTL_LOCALE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("content.pages.meta.news") };
}

const CMS = "/api/v1/admin/cms";
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

/** Newest activity first: the last publication, else the last save. */
function sortKey(p: CmsPageSummary): string {
  return p.publication?.publishedAt && p.publication.publishedAt > p.updatedAt
    ? p.publication.publishedAt
    : p.updatedAt;
}

/**
 * DP-020: the news articles of one site (TEMPLATE pages with the article template at
 * /news/<slug>). The same draft, preview and publication model as every CMS page.
 */
export default async function NewsListPage({ searchParams }: PageProps<"/content/news">) {
  await requireStaffSession();
  const params = await searchParams;
  const t = await getTranslator();
  const uiLocale = await getAdminLocale();
  const DATE = dateTimeFormat(uiLocale, DATE_OPTIONS);
  const context = await serverRead(`${CMS}/context`, CmsContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title={t("content.pages.news.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("content.pages.shared.noAccessTitle")}>
            {t("content.pages.shared.noAccessBody")}
          </EmptyState>
        </div>
      </div>
    );
  }
  const { sites } = context.data;
  const site = pickCmsSite(sites, typeof params["site"] === "string" ? params["site"] : undefined);
  const sp = site.key.toLowerCase();
  // ML-2 (DP-074): the articles of one language (default: the site's default language).
  const defaultLocale = site.locales.find((l) => l.isDefault)?.locale ?? site.locale;
  const wanted = typeof params["locale"] === "string" ? params["locale"] : defaultLocale;
  const locale = site.locales.some((l) => l.locale === wanted) ? wanted : defaultLocale;
  const list = await serverRead(
    `${CMS}/sites/${site.id}/pages${locale === defaultLocale ? "" : `?locale=${encodeURIComponent(locale)}`}`,
    CmsPageListResponseSchema,
  );
  const articles = list.ok
    ? list.data.items.filter(cmsIsArticle).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
    : [];
  const newHref = `/content/news/new?site=${sp}`;
  // DP-153: the heading of the site's news list is the designed page bv.news-index.
  const heading = list.ok
    ? list.data.items.find((p) => p.templateKey === "bv.news-index")
    : undefined;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="content"
        title={t("content.pages.news.contentTitle")}
        description={t("content.pages.news.description")}
        actions={
          site.canEdit ? (
            <Link href={newHref} className={buttonStyles.primary}>
              <Icon name="plus" size={17} />
              {t("content.pages.news.newArticle")}
            </Link>
          ) : null
        }
      />

      <ContentTabs current="news" siteParam={sp} t={t} />

      <LanguageTabs
        site={site}
        current={locale}
        hrefFor={(l) => `/content/news?site=${sp}&locale=${l}`}
        t={t}
        locale={uiLocale}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={(s) => `/content/news?site=${s.key.toLowerCase()}`}
        />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? t("content.pages.news.canEdit", { locale: site.locale })
            : t("content.pages.shared.readOnly")}
        </p>
      </div>

      {site.key === "BV" && list.ok ? (
        <p className="text-sm text-ink-2">
          {heading ? (
            <span key="heading">
              {t("content.pages.news.headingBefore")}
              <Link
                href={`/content/${heading.id}?site=${sp}`}
                className="font-medium text-ink underline underline-offset-4"
              >
                {t("content.pages.news.headingLink")}
              </Link>
              {t("content.pages.news.headingAfter", {
                state: publicationState(heading, t).label.toLocaleLowerCase(INTL_LOCALE[uiLocale]),
              })}
            </span>
          ) : (
            <span key="missing">
              {t("content.pages.news.missingBefore")}
              <Link
                href={`/content?site=${sp}`}
                className="font-medium text-ink underline underline-offset-4"
              >
                {t("content.pages.news.missingLink")}
              </Link>
              {t("content.pages.news.missingAfter")}
            </span>
          )}
        </p>
      ) : null}

      <Panel
        id="news-articles"
        title={t("content.pages.news.panelTitle")}
        description={
          list.ok ? t("content.pages.news.count", { count: articles.length }) : undefined
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!list.ok ? (
          <ErrorState title={t("content.pages.news.loadError")}>
            {list.status === 403
              ? t("content.pages.shared.forbidden")
              : t("content.pages.shared.tryAgain")}
          </ErrorState>
        ) : articles.length === 0 ? (
          <EmptyState
            icon="content"
            title={t("content.pages.news.emptyTitle")}
            {...(site.canEdit
              ? { action: { href: newHref, label: t("content.pages.news.newArticle") } }
              : {})}
          >
            {site.canEdit ? t("content.pages.news.emptyEdit") : t("content.pages.news.emptyRead")}
          </EmptyState>
        ) : (
          <ul
            className="divide-y divide-line border-t border-line"
            aria-label={t("content.pages.news.listLabel", { site: site.name })}
          >
            {articles.map((p) => {
              const state = publicationState(p, t);
              return (
                <li
                  key={p.id}
                  className="group relative transition-colors hover:bg-surface-2/70 focus-within:bg-surface-2/70"
                >
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,2.4fr)_auto_minmax(0,1.2fr)] md:items-center">
                    <div className="min-w-0">
                      <Link
                        href={`/content/${p.id}?site=${sp}`}
                        className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-petrol"
                      >
                        <span className="block truncate font-medium text-ink group-hover:text-petrol-strong">
                          {p.title}
                        </span>
                        <span className="block truncate font-mono text-xs text-ink-3">
                          {p.path}
                        </span>
                      </Link>
                    </div>
                    <div>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </div>
                    <p className="tabular text-sm text-ink-2 md:text-right">
                      {DATE.format(new Date(p.updatedAt))}
                      <span className="block text-xs text-ink-3">{p.updatedBy.name}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
