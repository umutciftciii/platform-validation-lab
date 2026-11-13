import type { Metadata } from "next";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  type CatalogSite,
} from "@dream/contracts";
import { CategoryManager } from "../../../../components/catalog/category-manager";
import {
  PageHeader,
  pickSite,
  SITE_SHORT,
  SiteSwitcher,
  siteParam,
} from "../../../../components/catalog/parts";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Product categories" };

export default async function CategoriesPage({ searchParams }: PageProps<"/products/categories">) {
  await requireStaffSession();
  const query = await searchParams;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="folder" title="Product categories" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
        </EmptyState>
      </div>
    );
  }
  const { sites } = context.data;
  const site = pickSite(sites, typeof query["site"] === "string" ? query["site"] : undefined);
  const sp = siteParam(site);
  const list = await serverRead(
    `/api/v1/admin/catalog/sites/${site.id}/categories`,
    CategoryListResponseSchema,
  );
  const hrefFor = (s: CatalogSite) => `/products/categories?site=${siteParam(s)}`;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="folder"
        title="Product categories"
        back={{ href: `/products?site=${sp}`, label: "All products" }}
        description="Each site has its own category tree, up to three levels. The default category receives new listings that name no category."
      />
      <SiteSwitcher sites={sites} current={site.id} hrefFor={hrefFor} />
      <Panel
        id="categories"
        title={`Categories on ${SITE_SHORT[site.key]}`}
        description={
          list.ok
            ? `${list.data.items.length} categor${list.data.items.length === 1 ? "y" : "ies"}`
            : undefined
        }
        bodyClassName="px-0! pb-5! pt-3!"
      >
        {list.ok ? (
          <CategoryManager
            key={site.id}
            siteId={site.id}
            siteName={SITE_SHORT[site.key]}
            items={list.data.items}
            canEdit={site.canEdit}
          />
        ) : (
          <ErrorState title="The categories could not be loaded">
            You are not allowed to read this site&apos;s catalogue.
          </ErrorState>
        )}
      </Panel>
    </div>
  );
}
