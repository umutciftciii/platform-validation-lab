import type { Metadata } from "next";
import Link from "next/link";
import {
  ADMIN_SEO_API,
  BV_SITE_SEO_KEY,
  CatalogContextResponseSchema,
  CmsContextResponseSchema,
  SeoOverviewResponseSchema,
  type SeoOverviewItem,
} from "@dream/contracts";
import { ImportButton } from "../../../components/cms/import-button";
import { PageHeader } from "../../../components/catalog/parts";
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
import {
  filterSeoItems,
  parseSeoFilter,
  SEO_FILTERS,
  SEO_KIND_LABEL,
  seoEditHref,
  seoNotes,
  seoPublicPath,
} from "../../../lib/seo-overview";
import { bvPublicOrigin } from "../../../lib/seo-server";
import { CODE_SITE_SEO, previewImageSrc, seoView } from "../../../lib/seo-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "SEO" };

/**
 * DP-209 (ADR-024 D6): the SEO of the BV site in one place. The site defaults are the
 * `bv.site-seo` CMS fragment (edited, published and restored in the page editor); the list shows
 * every page, article and product with its SEO state and opens its existing editor. Nothing is
 * edited or stored here a second time. Permissions: the API answers with what the caller may
 * read (content:read, product:read) and change.
 */
export default async function SeoPage({ searchParams }: PageProps<"/seo">) {
  await requireStaffSession();
  const params = await searchParams;
  const filter = parseSeoFilter(params["filter"]);
  const [cms, catalog] = await Promise.all([
    serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema),
    serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema),
  ]);
  const bv =
    (cms.ok ? cms.data.sites.find((s) => s.key === "BV") : undefined) ??
    (catalog.ok ? catalog.data.sites.find((s) => s.key === "BV") : undefined);
  if (!bv) {
    return (
      <div className="space-y-8">
        <PageHeader icon="search" title="SEO" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="No access to the BV site">
            Your roles do not include reading content or products of Dream Petroleum BV.
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
        <PageHeader icon="search" title="SEO" />
        <ErrorState title="The SEO overview could not be loaded">
          {res.status === 403
            ? "You are not allowed to read the content or products of this site."
            : "Try again in a moment."}
        </ErrorState>
      </div>
    );
  }
  const { settings, liveSettings, items, permissions } = res.data;
  const origin = bvPublicOrigin();
  const site = liveSettings ?? CODE_SITE_SEO;
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
        title="SEO"
        description="Search results and link previews of dreampetroleumbv.com: the site defaults and the SEO of every page, article and product. Changes reach the site when the page or product is published."
      />
      <SeoTabs current="overview" />

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span>
          Search engines may index the site only in production with indexing switched on. DEV and
          staging always answer noindex, whatever is set here. Unpublished or hidden products are
          never indexed.
        </span>
      </p>

      <Panel
        id="seo-defaults"
        title="Site defaults"
        description="Used where a page has no value of its own: site name, default title, meta description and link-preview image."
        action={
          settings ? (
            <StatusPill
              tone={!settings.published ? "neutral" : settings.pendingChanges ? "amber" : "success"}
            >
              {!settings.published
                ? "Draft, not published"
                : settings.pendingChanges
                  ? "Changes not published"
                  : "Published"}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">Built-in defaults</StatusPill>
          )
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-ink-3">Site name</dt>
              <dd className="break-words text-ink">{draftSite.siteName}</dd>
              <dt className="text-ink-3">Default title</dt>
              <dd className="break-words text-ink">{draftSite.defaultTitle}</dd>
              <dt className="text-ink-3">Default description</dt>
              <dd className="break-words text-ink">{draftSite.defaultDescription ?? "None"}</dd>
              <dt className="text-ink-3">Default image</dt>
              <dd className="break-all font-mono text-xs text-ink-2">{draftSite.defaultOgImage}</dd>
            </dl>
            {settings ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/content/${settings.pageId}`} className={buttonStyles.primary}>
                  <Icon name="edit" size={17} />
                  <span>{permissions.editPages ? "Edit defaults" : "View defaults"}</span>
                </Link>
                <span className="text-xs text-ink-3">
                  Draft, preview, publish and history work as for every page.
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-2">
                  The site uses its built-in defaults. Create the defaults in the CMS to edit them;
                  the site keeps the built-in values until they are published.
                </p>
                {permissions.editPages ? (
                  <ImportButton
                    siteId={bv.id}
                    siteParam="bv"
                    templateKey={BV_SITE_SEO_KEY}
                    title="SEO defaults"
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
        title="Pages, articles and products"
        description={`${items.length} addresses · ${inSitemap} in the sitemap. Each row opens its editor.`}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        <nav aria-label="Filter" className="flex flex-wrap gap-2 px-5 pb-3 sm:px-6">
          {SEO_FILTERS.map((f) => (
            <Link
              key={f.id}
              href={f.id === "all" ? "/seo" : `/seo?filter=${f.id}`}
              aria-current={f.id === filter ? "page" : undefined}
              className={cx(
                "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                f.id === filter
                  ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                  : "bg-surface-2 text-ink-2 ring-line hover:text-ink",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3 sm:px-6">Nothing to show for this filter.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((item) => (
              <SeoRow key={`${item.source}-${item.id}`} item={item} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SeoRow({ item }: { item: SeoOverviewItem }) {
  const notes = seoNotes(item);
  return (
    <li className="px-5 py-3 sm:px-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link
              href={seoEditHref(item, "bv")}
              className="break-words font-medium text-ink underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2 ring-1 ring-inset ring-line">
              {SEO_KIND_LABEL[item.kind]}
            </span>
          </p>
          <p className="break-all font-mono text-xs text-ink-3">{seoPublicPath(item.path)}</p>
          <p className="break-words text-sm text-ink-2">
            {item.title ?? "No SEO title (the page name is used)"}
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
          {item.noindex ? <StatusPill tone="amber">Noindex</StatusPill> : null}
          {!item.live ? (
            <StatusPill tone="neutral">Not live</StatusPill>
          ) : item.pendingChanges ? (
            <StatusPill tone="amber">Changes not published</StatusPill>
          ) : (
            <StatusPill tone="success">Live</StatusPill>
          )}
          {item.inSitemap ? <StatusPill tone="petrol">In sitemap</StatusPill> : null}
        </div>
      </div>
    </li>
  );
}
