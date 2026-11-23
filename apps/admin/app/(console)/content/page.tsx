import type { Metadata } from "next";
import Link from "next/link";
import {
  CMS_SITE_REGISTRY,
  CmsContextResponseSchema,
  CmsPageListResponseSchema,
  cmsIsArticle,
  type CmsRegistryEntry,
  type CmsSite,
} from "@dream/contracts";
import { ContentTabs } from "../../../components/cms/content-tabs";
import { ImportButton } from "../../../components/cms/import-button";
import { LanguageTabs } from "../../../components/cms/language-tabs";
import { SiteLanguagesPanel } from "../../../components/cms/site-languages";
import { translationStateLabel } from "../../../components/cms/translation-tabs";
import {
  CmsKindPill,
  pickCmsSite,
  publicationState,
  RegistryPill,
} from "../../../components/cms/parts";
import { PageHeader, SiteSwitcher } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { buttonStyles, EmptyState, ErrorState, Panel, StatusPill } from "../../../components/ui";
import { cmsText } from "../../../lib/cms-text";
import { ADMIN_TIME_ZONE } from "../../../lib/i18n/config";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("content.pages.meta.content") };
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

/**
 * CMS S1 (DP-015): the pages of one site. CMS pages (drafts) on top; below them every other
 * route of the site and who manages it today (designed pages waiting for their import, legal
 * texts in versioned contracts, product pages in the catalogue).
 */
export default async function ContentPage({ searchParams }: PageProps<"/content">) {
  await requireStaffSession();
  const params = await searchParams;
  const t = await getTranslator();
  const uiLocale = await getAdminLocale();
  const DATE = dateTimeFormat(uiLocale, DATE_OPTIONS);
  const context = await serverRead(`${CMS}/context`, CmsContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title={t("content.pages.list.title")} />
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
  // ML-2 (DP-074): one language at a time; the default language lists every page with the state
  // of its translations.
  const defaultLocale = site.locales.find((l) => l.isDefault)?.locale ?? site.locale;
  const wanted = typeof params["locale"] === "string" ? params["locale"] : defaultLocale;
  const locale = site.locales.some((l) => l.locale === wanted) ? wanted : defaultLocale;
  const isDefault = locale === defaultLocale;
  const list = await serverRead(
    `${CMS}/sites/${site.id}/pages${isDefault ? "" : `?locale=${encodeURIComponent(locale)}`}`,
    CmsPageListResponseSchema,
  );
  // A registry entry leaves the list once its page exists in the CMS: designed pages and
  // fragments by their key, content pages by their path.
  // News articles (DP-020) have their own list under /content/news.
  const pages = list.ok ? list.data.items.filter((p) => !cmsIsArticle(p)) : [];
  const imported = new Set(pages.filter((p) => p.kind !== "TEMPLATE").map((p) => p.templateKey));
  // Every path, articles included: an imported article (DP-206) leaves the registry list too.
  const paths = new Set((list.ok ? list.data.items : []).map((p) => p.path));
  const routes = isDefault
    ? CMS_SITE_REGISTRY.filter(
        (e) =>
          e.site === site.key &&
          !imported.has(e.key) &&
          !(e.kind === "TEMPLATE" && paths.has(e.path)),
      )
    : [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="content"
        title={t("content.pages.list.title")}
        description={t("content.pages.list.description")}
        actions={
          site.canEdit ? (
            <Link href={`/content/new?site=${sp}`} className={buttonStyles.primary}>
              <Icon name="plus" size={17} />
              {t("content.pages.list.newPage")}
            </Link>
          ) : null
        }
      />

      <ContentTabs current="pages" siteParam={sp} t={t} />

      <LanguageTabs
        site={site}
        current={locale}
        hrefFor={(l) => `/content?site=${sp}&locale=${l}`}
        t={t}
        locale={uiLocale}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={(s) => `/content?site=${s.key.toLowerCase()}`}
        />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? t("content.pages.list.canEdit", { locale: site.locale })
            : t("content.pages.shared.readOnly")}
        </p>
      </div>

      <Panel
        id="cms-pages"
        title={t("content.pages.list.panelTitle")}
        description={list.ok ? t("content.pages.list.count", { count: pages.length }) : undefined}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!list.ok ? (
          <ErrorState title={t("content.pages.list.loadError")}>
            {list.status === 403
              ? t("content.pages.shared.forbidden")
              : t("content.pages.shared.tryAgain")}
          </ErrorState>
        ) : pages.length === 0 ? (
          <EmptyState
            icon="content"
            title={t("content.pages.list.emptyTitle")}
            {...(site.canEdit
              ? {
                  action: {
                    href: `/content/new?site=${sp}`,
                    label: t("content.pages.list.newPage"),
                  },
                }
              : {})}
          >
            {site.canEdit ? t("content.pages.list.emptyEdit") : t("content.pages.list.emptyRead")}
          </EmptyState>
        ) : (
          <ul
            className="divide-y divide-line border-t border-line"
            aria-label={t("content.pages.list.listLabel", { site: site.name })}
          >
            {pages.map((p) => (
              <li
                key={p.id}
                className="group relative transition-colors hover:bg-surface-2/70 focus-within:bg-surface-2/70"
              >
                <div className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1.2fr)] md:items-center">
                  <div className="min-w-0">
                    <Link
                      href={`/content/${p.id}?site=${sp}`}
                      className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-petrol"
                    >
                      <span className="block truncate font-medium text-ink group-hover:text-petrol-strong">
                        {p.title}
                      </span>
                      <span className="block truncate font-mono text-xs text-ink-3">
                        {p.path ?? t("content.common.siteWidePart")}
                      </span>
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CmsKindPill kind={p.kind} />
                    <span className="text-xs text-ink-3">
                      {t("content.pages.list.sections", { count: p.sectionCount })}
                    </span>
                    {p.translations.map((tr) => (
                      <StatusPill
                        key={`tr-${tr.locale}`}
                        tone={translationStateLabel(tr, t).tone}
                      >{`${tr.locale.toUpperCase()}: ${translationStateLabel(tr, t).label}`}</StatusPill>
                    ))}
                  </div>
                  <div>
                    <StatusPill tone={publicationState(p, t).tone}>
                      {publicationState(p, t).label}
                    </StatusPill>
                  </div>
                  <p className="tabular text-sm text-ink-2 md:text-right">
                    {DATE.format(new Date(p.updatedAt))}
                    <span className="block text-xs text-ink-3">{p.updatedBy.name}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SiteLanguagesPanel site={site} t={t} locale={uiLocale} />

      {isDefault ? (
        <Panel
          id="site-routes"
          title={t("content.pages.list.routesTitle")}
          description={t("content.pages.list.routesDescription")}
          bodyClassName="px-0! pb-2! pt-3!"
        >
          {routes.length === 0 ? (
            <EmptyState icon="check" title={t("content.pages.list.routesEmpty")} />
          ) : (
            <ul
              className="divide-y divide-line border-t border-line"
              aria-label={t("content.pages.list.routesLabel", { site: site.name })}
            >
              {routes.map((e) => (
                <RouteRow key={e.key} entry={e} site={site} t={t} />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function RouteRow({ entry, site, t }: { entry: CmsRegistryEntry; site: CmsSite; t: Translate }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,2.2fr)] md:items-center">
      <div className="min-w-0">
        <span className="block font-medium text-ink">{entry.title}</span>
        <span className="block font-mono text-xs text-ink-3">
          {entry.path ?? t("content.common.siteWidePart")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RegistryPill entry={entry} />
      </div>
      <p className="text-sm text-ink-2">
        {cmsText(entry.note, t)}
        {entry.managedBy === "catalog" ? (
          <span>
            {" "}
            <Link
              href={`/products?site=${site.key.toLowerCase()}`}
              className="font-medium text-petrol-strong hover:underline"
            >
              {t("content.pages.list.openProducts")}
            </Link>
          </span>
        ) : null}
      </p>
      {entry.managedBy === "cms_pending" && entry.importable && site.canEdit ? (
        <div className="md:col-span-3">
          <ImportButton
            siteId={site.id}
            siteParam={site.key.toLowerCase()}
            templateKey={entry.key}
            title={entry.title}
          />
        </div>
      ) : null}
    </li>
  );
}
