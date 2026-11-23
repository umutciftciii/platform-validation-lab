import type { Metadata } from "next";
import { CatalogContextResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { ProductMasterForm } from "../../../../components/catalog/product-master-form";
import { EmptyState, Panel } from "../../../../components/ui";
import { getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.list.newProduct.title") };
}

export default async function NewProductPage({ searchParams }: PageProps<"/products/new">) {
  await requireStaffSession();
  const t = await getTranslator();
  const query = await searchParams;
  const sp =
    typeof query["site"] === "string" && /^[a-z]{2,12}$/.test(query["site"]) ? query["site"] : "bv";
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  const back = { href: `/products?site=${sp}`, label: t("catalog.list.newProduct.back") };
  if (!context.ok || !context.data.canEditMaster) {
    return (
      <div className="space-y-8">
        <PageHeader icon="products" title={t("catalog.list.newProduct.title")} back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("catalog.list.newProduct.noAccessTitle")}>
            {t("catalog.list.newProduct.noAccessText", { permission: "product_master:edit" })}
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="products"
        title={t("catalog.list.newProduct.title")}
        back={back}
        description={t("catalog.list.newProduct.description")}
      />
      <Panel id="master" title={t("catalog.list.newProduct.panelTitle")} className="max-w-3xl">
        <ProductMasterForm product={null} canEdit siteParam={sp} />
      </Panel>
    </div>
  );
}
