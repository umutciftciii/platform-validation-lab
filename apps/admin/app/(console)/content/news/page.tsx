import type { Metadata } from "next";
import Link from "next/link";
import {
  CmsContextResponseSchema,
  CmsPageListResponseSchema,
  cmsIsArticle,
  type CmsPageSummary,
} from "@dream/contracts";
import { ContentTabs } from "../../../../components/cms/content-tabs";
import { pickCmsSite, publicationState } from "../../../../components/cms/parts";
import { PageHeader, SiteSwitcher } from "../../../../components/catalog/parts";
import { Icon } from "../../../../components/icons";
import { buttonStyles, EmptyState, ErrorState, Panel, StatusPill } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "News" };

const CMS = "/api/v1/admin/cms";
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

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
  const context = await serverRead(`${CMS}/context`, CmsContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title="News" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="No access to site content">
            Your roles do not include reading content on any site. Ask a site or platform
            administrator for a content role.
          </EmptyState>
        </div>
      </div>
    );
  }
  const { sites } = context.data;
  const site = pickCmsSite(sites, typeof params["site"] === "string" ? params["site"] : undefined);
  const sp = site.key.toLowerCase();
  const list = await serverRead(`${CMS}/sites/${site.id}/pages`, CmsPageListResponseSchema);
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
        title="Content"
        description="News articles of the public sites. Write drafts, preview them and publish; the site lists only what is published, newest first."
        actions={
          site.canEdit ? (
            <Link href={newHref} className={buttonStyles.primary}>
              <Icon name="plus" size={17} />
              New article
            </Link>
          ) : null
        }
      />

      <ContentTabs current="news" siteParam={sp} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={(s) => `/content/news?site=${s.key.toLowerCase()}`}
        />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? `You can write and edit articles of this site (${site.locale}).`
            : "Read only on this site."}
        </p>
      </div>

      {site.key === "BV" && list.ok ? (
        <p className="text-sm text-ink-2">
          {heading ? (
            <>
              Heading and introduction of the news list:{" "}
              <Link
                href={`/content/${heading.id}?site=${sp}`}
                className="font-medium text-ink underline underline-offset-4"
              >
                edit the News page
              </Link>{" "}
              ({publicationState(heading).label.toLowerCase()}).
            </>
          ) : (
            <>
              The heading of the news list is not in the CMS yet: import “News” under{" "}
              <Link
                href={`/content?site=${sp}`}
                className="font-medium text-ink underline underline-offset-4"
              >
                Pages
              </Link>
              , then publish it. Until then the site shows the list as unavailable.
            </>
          )}
        </p>
      ) : null}

      <Panel
        id="news-articles"
        title="Articles"
        description={
          list.ok
            ? articles.length === 1
              ? "1 article"
              : `${articles.length} articles`
            : undefined
        }
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!list.ok ? (
          <ErrorState title="The article list could not be loaded">
            {list.status === 403
              ? "You are not allowed to read content on this site."
              : "Try again in a moment."}
          </ErrorState>
        ) : articles.length === 0 ? (
          <EmptyState
            icon="content"
            title="No articles on this site yet"
            {...(site.canEdit ? { action: { href: newHref, label: "New article" } } : {})}
          >
            {site.canEdit
              ? "Write the first article: a title, a summary, an optional cover image and the body."
              : "Content editors of this site write articles here."}
          </EmptyState>
        ) : (
          <ul
            className="divide-y divide-line border-t border-line"
            aria-label={`News articles of ${site.name}`}
          >
            {articles.map((p) => {
              const state = publicationState(p);
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
