import type { Metadata } from "next";
import { CatalogContextResponseSchema, GlobalBrandListResponseSchema } from "@dream/contracts";
import { GlobalCatalogManager } from "../../../../components/catalog/global-catalog";
import { NoticeProvider } from "../../../../components/catalog/notices";
import { PageHeader } from "../../../../components/catalog/parts";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Global brands" };

export default async function GlobalBrandsPage() {
  await requireStaffSession();
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="list" title="Global brands" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
        </EmptyState>
      </div>
    );
  }
  const list = await serverRead(
    "/api/v1/admin/catalog/global-brands?archived=1",
    GlobalBrandListResponseSchema,
  );
  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="list"
          title="Global brands"
          back={{ href: "/products", label: "All products" }}
          description="Other manufacturers' brands and products (with grade) that our products are cross-referenced with. Shared by both sites; archived, never deleted."
        />
        <Panel
          id="brands"
          title="Brands"
          description="Search, add and maintain brands; open a brand to manage its products."
        >
          {list.ok ? (
            <GlobalCatalogManager
              key={list.data.items.map((b) => `${b.id}:${b.version}`).join(",")}
              brands={list.data.items}
              canEdit={list.data.canEdit}
            />
          ) : (
            <ErrorState title="The global brands could not be loaded">
              Try again in a moment.
            </ErrorState>
          )}
        </Panel>
      </div>
    </NoticeProvider>
  );
}
