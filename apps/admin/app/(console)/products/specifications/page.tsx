import type { Metadata } from "next";
import { CatalogContextResponseSchema, SpecDefinitionListResponseSchema } from "@dream/contracts";
import { NoticeProvider } from "../../../../components/catalog/notices";
import { PageHeader } from "../../../../components/catalog/parts";
import { SpecDefinitionManager } from "../../../../components/catalog/spec-definitions";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Specifications" };

export default async function SpecificationsPage() {
  await requireStaffSession();
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="list" title="Specifications" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
        </EmptyState>
      </div>
    );
  }
  const list = await serverRead(
    "/api/v1/admin/catalog/spec-definitions",
    SpecDefinitionListResponseSchema,
  );
  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="list"
          title="Specifications"
          back={{ href: "/products", label: "All products" }}
          description="Technical properties tracked for every product master: type, units, test methods and limits. Defined once for the whole platform."
        />
        <Panel
          id="definitions"
          title="Specification definitions"
          description={list.ok ? `${list.data.items.length} defined` : undefined}
          bodyClassName="px-0! pb-5! pt-3!"
        >
          {list.ok ? (
            <SpecDefinitionManager items={list.data.items} canEdit={context.data.canEditMaster} />
          ) : (
            <ErrorState title="The specifications could not be loaded">
              Try again in a moment.
            </ErrorState>
          )}
        </Panel>
      </div>
    </NoticeProvider>
  );
}
