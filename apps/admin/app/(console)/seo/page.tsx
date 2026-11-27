import type { Metadata } from "next";
import Link from "next/link";
import {
  ADMIN_SEO_API,
  CMS_SITE_SEO_KEYS,
  CatalogContextResponseSchema,
  CmsContextResponseSchema,
  SeoOverviewResponseSchema,
  type SeoOverviewItem,
} from "@dream/contracts";
import { ImportButton } from "../../../components/cms/import-button";
import { PageHeader, SiteSwitcher } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { SeoPreview } from "../../../components/seo/seo-preview";
import { SeoTabs } from "../../../components/seo/seo-tabs";
import {
  buttonStyles,
  cx,
  EmptyState,
  ErrorState,
  Panel,
  StatusPill,
} from "../../../components/ui";
import { getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import {
  filterSeoItems,
  parseSeoFilter,
  SEO_FILTERS,
  seoEditHref,
  seoFilterLabel,
  seoKindLabel,
  seoNotes,
  seoPublicPath,
} from "../../../lib/seo-overview";
import { sitePublicOrigin } from "../../../lib/seo-server";
import { pickSeoSite, seoSites, withSeoSite } from "../../../lib/seo-site";
import { previewImageSrc, seoView, siteSeoDefaultsOf } from "../../../lib/seo-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("seo.overview.metaTitle") };
}

/**
 * DP-209 (ADR-024 D6): the SEO of a site in one place (COM-1: BV or the corporate site, `?site=`). The site defaults are the
 * `bv.site-seo` CMS fragment (edited, published and restored in the page editor); the list shows
 * every page, article and product with its SEO state and opens its existing editor. Nothing is
 * edited or stored here a second time. Permissions: the API answers with what the caller may
 * read (content:read, product:read) and change.
 * ML-12d (DP-243): every UI text in the console's language (`seo.overview.*`); SEO data, addresses,
 * filters and the API calls are unchanged.
 */
export default async function SeoPage({ searchParams }: PageProps<"/seo">) {
  await requireStaffSession();
  const t = await getTranslator();
  const params = await searchParams;
  const filter = parseSeoFilter(params["filter"]);
  const [cms, catalog] = await Promise.all([
    serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema),
    serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema),
  ]);
  // COM-1: one site at a time (`?site=bv|corporate`, BV by default).
  const sites = seoSites(cms.ok ? cms.data.sites : null, catalog.ok ? catalog.data.sites : null);
  const bv = pickSeoSite(sites, params["site"]);
  if (!bv) {
    return (
      <div className="space-y-8">
        <PageHeader icon="search" title={t("seo.overview.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("seo.common.noAccessTitle")}>
            {t("seo.common.noAccessText")}
          </EmptyState>
        </div>
      </div>
    );
  }
  const res = await serverRead(
    `${ADMIN_SEO_API}/sites/${bv.id}/overview`,
    SeoOverviewResponseSchema,
  );
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="search" title={t("seo.overview.title")} />
        <ErrorState title={t("seo.overview.loadError")}>
          {res.status === 403 ? t("seo.common.forbidden") : t("seo.common.tryAgain")}
        </ErrorState>
      </div>
    );
  }
  const { settings, liveSettings, items, permissions } = res.data;
  const origin = sitePublicOrigin(bv.key);
  const site = siteSeoDefaultsOf(liveSettings);
  const shown = filterSeoItems(items, filter);
  const draft = settings?.draft ?? {};
  const text = (k: string) => (typeof draft[k] === "string" ? (draft[k] as string) : "");
  const draftSite = settings
    ? {
        siteName: text("siteName") || site.siteName,
        defaultTitle: text("defaultTitle") || site.defaultTitle,
        defaultDescription: text("defaultDescription") || null,
        defaultOgImage: text("defaultOgImage") || site.defaultOgImage,
      }
    : site;
  const defaultsView = seoView(
    {
      path: "/",
      fallbackTitle: draftSite.defaultTitle,
      title: "",
      description: "",
      canonicalPath: "",
      noindex: false,
      ogTitle: "",
      ogDescription: "",
      ogImageUrl: null,
    },
    draftSite,
    origin,
  );
  const inSitemap = items.filter((i) => i.inSitemap).length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="search"
        title={t("seo.overview.title")}
        description={t("seo.overview.description")}
      />
      <SeoTabs current="overview" t={t} siteKey={bv.key} />

      {sites.length > 1 ? (
        <SiteSwitcher
          sites={sites}
          current={bv.id}
          hrefFor={(s) => withSeoSite("/seo", s.key)}
          label={t("seo.common.site")}
        />
      ) : null}

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span>{t("seo.overview.indexingNote")}</span>
      </p>

      <Panel
        id="seo-defaults"
        title={t("seo.overview.defaults.title")}
        description={t("seo.overview.defaults.description")}
        action={
          settings ? (
            <StatusPill
              tone={!settings.published ? "neutral" : settings.pendingChanges ? "amber" : "success"}
            >
              {!settings.published
                ? t("seo.overview.defaults.draftNotPublished")
                : settings.pendingChanges
                  ? t("seo.overview.defaults.changesNotPublished")
                  : t("seo.overview.defaults.published")}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">{t("seo.overview.defaults.builtIn")}</StatusPill>
          )
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-ink-3">{t("seo.overview.defaults.siteName")}</dt>
              <dd className="break-words text-ink">{draftSite.siteName}</dd>
              <dt className="text-ink-3">{t("seo.overview.defaults.defaultTitle")}</dt>
              <dd className="break-words text-ink">{draftSite.defaultTitle}</dd>
              <dt className="text-ink-3">{t("seo.overview.defaults.defaultDescription")}</dt>
              <dd className="break-words text-ink">
                {draftSite.defaultDescription ?? t("seo.overview.defaults.none")}
              </dd>
              <dt className="text-ink-3">{t("seo.overview.defaults.defaultImage")}</dt>
              <dd className="break-all font-mono text-xs text-ink-2">
                {draftSite.defaultOgImage || t("seo.overview.defaults.none")}
              </dd>
            </dl>
            {settings ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/content/${settings.pageId}`} className={buttonStyles.primary}>
                  <Icon name="edit" size={17} />
                  <span>
                    {permissions.editPages
                      ? t("seo.overview.defaults.edit")
                      : t("seo.overview.defaults.view")}
                  </span>
                </Link>
                <span className="text-xs text-ink-3">{t("seo.overview.defaults.pageNote")}</span>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-2">{t("seo.overview.defaults.builtInText")}</p>
                {permissions.editPages ? (
                  <ImportButton
                    siteId={bv.id}
                    siteParam={bv.key.toLowerCase()}
                    templateKey={CMS_SITE_SEO_KEYS[bv.key]}
                    title={t("seo.overview.defaults.importTitle")}
                  />
                ) : null}
              </div>
            )}
          </div>
          <SeoPreview
            view={defaultsView}
            siteName={draftSite.siteName}
            imageSrc={previewImageSrc(draftSite.defaultOgImage, origin)}
            noindex={false}
          />
        </div>
      </Panel>

      <Panel
        id="seo-pages"
        title={t("seo.overview.list.title")}
        description={t("seo.overview.list.description", {
          count: items.length,
          sitemap: inSitemap,
        })}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <nav
          aria-label={t("seo.overview.list.filterLabel")}
          className="flex flex-wrap gap-2 px-5 pb-3 sm:px-6"
        >
          {SEO_FILTERS.map((f) => (
            <Link
              key={f.id}
              href={withSeoSite(f.id === "all" ? "/seo" : `/seo?filter=${f.id}`, bv.key)}
              aria-current={f.id === filter ? "page" : undefined}
              className={cx(
                "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                f.id === filter
                  ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                  : "bg-surface-2 text-ink-2 ring-line hover:text-ink",
              )}
            >
              {seoFilterLabel(f.id, t)}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3 sm:px-6">{t("seo.overview.list.empty")}</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((item) => (
              <SeoRow
                key={`${item.source}-${item.id}`}
                item={item}
                t={t}
                siteParam={bv.key.toLowerCase()}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SeoRow({
  item,
  t,
  siteParam,
}: {
  item: SeoOverviewItem;
  t: Translate;
  siteParam: string;
}) {
  const notes = seoNotes(item, t);
  return (
    <li className="px-5 py-3 sm:px-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link
              href={seoEditHref(item, siteParam)}
              className="break-words font-medium text-ink underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2 ring-1 ring-inset ring-line">
              {seoKindLabel(item.kind, t)}
            </span>
          </p>
          <p className="break-all font-mono text-xs text-ink-3">{seoPublicPath(item.path)}</p>
          <p className="break-words text-sm text-ink-2">
            {item.title ?? t("seo.overview.list.noTitle")}
          </p>
          {notes.length ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {notes.map((n) => (
                <li key={n} className="flex items-center gap-1 text-xs text-amber-ink">
                  <Icon name="alert" size={13} className="shrink-0" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.noindex ? (
            <StatusPill tone="amber">{t("seo.overview.list.noindex")}</StatusPill>
          ) : null}
          {!item.live ? (
            <StatusPill tone="neutral">{t("seo.overview.list.notLive")}</StatusPill>
          ) : item.pendingChanges ? (
            <StatusPill tone="amber">{t("seo.overview.list.changesNotPublished")}</StatusPill>
          ) : (
            <StatusPill tone="success">{t("seo.overview.list.live")}</StatusPill>
          )}
          {item.inSitemap ? (
            <StatusPill tone="petrol">{t("seo.overview.list.inSitemap")}</StatusPill>
          ) : null}
        </div>
      </div>
    </li>
  );
}
