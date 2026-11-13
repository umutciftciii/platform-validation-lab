import type { Metadata } from "next";
import { CatalogContextResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { ProductMasterForm } from "../../../../components/catalog/product-master-form";
import { EmptyState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ searchParams }: PageProps<"/products/new">) {
  await requireStaffSession();
  const query = await searchParams;
  const sp =
    typeof query["site"] === "string" && /^[a-z]{2,12}$/.test(query["site"]) ? query["site"] : "bv";
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  const back = { href: `/products?site=${sp}`, label: "All products" };
  if (!context.ok || !context.data.canEditMaster) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title="New product" back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="You cannot create product masters">
            Product masters are platform-wide. Creating them needs the platform permission
            product_master:edit (Platform Product Manager or Platform Super Admin).
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="products"
        title="New product"
        back={back}
        description="Create the platform-wide master record. Each site lists it separately afterwards."
      />
      <Panel id="master" title="Product master" className="max-w-3xl">
        <ProductMasterForm product={null} canEdit siteParam={sp} />
      </Panel>
    </div>
  );
}
