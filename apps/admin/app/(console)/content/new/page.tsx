import type { Metadata } from "next";
import { CmsContextResponseSchema } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { PageCreateForm } from "../../../../components/cms/page-create-form";
import { pickCmsSite } from "../../../../components/cms/parts";
import { EmptyState, Panel } from "../../../../components/ui";
import { getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("content.pages.meta.newPage") };
}

export default async function NewContentPage({ searchParams }: PageProps<"/content/new">) {
  await requireStaffSession();
  const query = await searchParams;
  const t = await getTranslator();
  const context = await serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema);
  const sites = context.ok ? context.data.sites : [];
  const site = sites.length
    ? pickCmsSite(sites, typeof query["site"] === "string" ? query["site"] : undefined)
    : null;
  const sp = site ? site.key.toLowerCase() : "bv";
  const back = { href: `/content?site=${sp}`, label: t("content.pages.newPage.back") };
  if (!site || !site.canEdit) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title={t("content.pages.newPage.title")} back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("content.pages.newPage.noEditTitle")}>
            {t("content.pages.newPage.noEditBody", { permission: "content:edit" })}
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="content"
        title={t("content.pages.newPage.title")}
        back={back}
        description={t("content.pages.newPage.description", { site: SITE_SHORT[site.key] })}
      />
      <Panel id="new-page" title={t("content.pages.newPage.panelTitle")} className="max-w-2xl">
        <PageCreateForm siteId={site.id} siteParam={sp} siteLabel={SITE_SHORT[site.key]} />
      </Panel>
    </div>
  );
}
