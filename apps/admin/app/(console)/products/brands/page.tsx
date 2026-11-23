import type { Metadata } from "next";
import { CatalogContextResponseSchema, GlobalBrandListResponseSchema } from "@dream/contracts";
import { GlobalCatalogManager } from "../../../../components/catalog/global-catalog";
import { NoticeProvider } from "../../../../components/catalog/notices";
import { PageHeader } from "../../../../components/catalog/parts";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";
import { getTranslator } from "../../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.xrefs.brandsPage.title") };
}

export default async function GlobalBrandsPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="list" title={t("catalog.xrefs.brandsPage.title")} />
        <EmptyState icon="shield" title={t("catalog.xrefs.brandsPage.noAccessTitle")}>
          {t("catalog.xrefs.brandsPage.noAccessText")}
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
          title={t("catalog.xrefs.brandsPage.title")}
          back={{ href: "/products", label: t("catalog.xrefs.brandsPage.back") }}
          description={t("catalog.xrefs.brandsPage.description")}
        />
        <Panel
          id="brands"
          title={t("catalog.xrefs.brandsPage.panelTitle")}
          description={t("catalog.xrefs.brandsPage.panelDescription")}
        >
          {list.ok ? (
            <GlobalCatalogManager
              key={list.data.items.map((b) => `${b.id}:${b.version}`).join(",")}
              brands={list.data.items}
              canEdit={list.data.canEdit}
            />
          ) : (
            <ErrorState title={t("catalog.xrefs.brandsPage.loadError")}>
              {t("catalog.xrefs.brandsPage.tryAgain")}
            </ErrorState>
          )}
        </Panel>
      </div>
    </NoticeProvider>
  );
}
