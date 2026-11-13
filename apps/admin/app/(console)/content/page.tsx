import type { Metadata } from "next";
import Link from "next/link";
import {
  CMS_SITE_REGISTRY,
  cmsDesignTemplate,
  CmsContextResponseSchema,
  CmsPageListResponseSchema,
  type CmsRegistryEntry,
  type CmsSite,
} from "@dream/contracts";
import { ImportButton } from "../../../components/cms/import-button";
import {
  CmsKindPill,
  pickCmsSite,
  publicationState,
  RegistryPill,
} from "../../../components/cms/parts";
import { PageHeader, SiteSwitcher } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { buttonStyles, EmptyState, ErrorState, Panel, StatusPill } from "../../../components/ui";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "Content" };

const CMS = "/api/v1/admin/cms";
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/**
 * CMS S1 (DP-015): the pages of one site. CMS pages (drafts) on top; below them every other
 * route of the site and who manages it today (designed pages waiting for their import, legal
 * texts in versioned contracts, product pages in the catalogue).
 */
export default async function ContentPage({ searchParams }: PageProps<"/content">) {
  await requireStaffSession();
  const params = await searchParams;
  const context = await serverRead(`${CMS}/context`, CmsContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title="Content" />
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
  const imported = new Set(
    list.ok ? list.data.items.filter((p) => p.kind !== "TEMPLATE").map((p) => p.templateKey) : [],
  );
  const routes = CMS_SITE_REGISTRY.filter((e) => e.site === site.key && !imported.has(e.key));

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="content"
        title="Content"
        description="Pages of the public sites. Edit drafts, preview them and publish; the sites show only what is published."
        actions={
          site.canEdit ? (
            <Link href={`/content/new?site=${sp}`} className={buttonStyles.primary}>
              <Icon name="plus" size={17} />
              New page
            </Link>
          ) : null
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={(s) => `/content?site=${s.key.toLowerCase()}`}
        />
        <p className="text-sm text-ink-3">
          {site.canEdit
            ? `You can create and edit pages of this site (${site.locale}).`
            : "Read only on this site."}
        </p>
      </div>

      <Panel
        id="cms-pages"
        title="CMS pages"
        description={list.ok ? countLabel(list.data.items.length) : undefined}
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {!list.ok ? (
          <ErrorState title="The page list could not be loaded">
            {list.status === 403
              ? "You are not allowed to read content on this site."
              : "Try again in a moment."}
          </ErrorState>
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon="content"
            title="No CMS pages on this site yet"
            {...(site.canEdit
              ? { action: { href: `/content/new?site=${sp}`, label: "New page" } }
              : {})}
          >
            {site.canEdit
              ? "Create a page from the standard template: hero, text, cards and call to action."
              : "Content editors of this site create pages here."}
          </EmptyState>
        ) : (
          <ul
            className="divide-y divide-line border-t border-line"
            aria-label={`CMS pages of ${site.name}`}
          >
            {list.data.items.map((p) => (
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
                        {p.path ?? "Site-wide part"}
                      </span>
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CmsKindPill kind={p.kind} />
                    <span className="text-xs text-ink-3">
                      {p.sectionCount} {p.sectionCount === 1 ? "section" : "sections"}
                    </span>
                  </div>
                  <div>
                    <StatusPill tone={publicationState(p).tone}>
                      {publicationState(p).label}
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

      <Panel
        id="site-routes"
        title="Existing site pages"
        description="Pages that are not managed in the CMS yet, or never will be. Their content is unchanged."
        bodyClassName="px-0! pb-2! pt-3!"
      >
        {routes.length === 0 ? (
          <EmptyState icon="check" title="Every page of this site is in the CMS" />
        ) : (
          <ul
            className="divide-y divide-line border-t border-line"
            aria-label={`Existing pages of ${site.name}`}
          >
            {routes.map((e) => (
              <RouteRow key={e.key} entry={e} site={site} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RouteRow({ entry, site }: { entry: CmsRegistryEntry; site: CmsSite }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2.2fr)] md:items-center">
      <div className="min-w-0">
        <span className="block font-medium text-ink">{entry.title}</span>
        <span className="block font-mono text-xs text-ink-3">{entry.path ?? "Site-wide part"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RegistryPill entry={entry} />
      </div>
      <p className="text-sm text-ink-2">
        {entry.note}
        {entry.managedBy === "catalog" ? (
          <>
            {" "}
            <Link
              href={`/products?site=${site.key.toLowerCase()}`}
              className="font-medium text-petrol-strong hover:underline"
            >
              Open Products
            </Link>
          </>
        ) : null}
      </p>
      {entry.managedBy === "cms_pending" && cmsDesignTemplate(entry.key) && site.canEdit ? (
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

function countLabel(n: number): string {
  return n === 1 ? "1 page" : `${n} pages`;
}
