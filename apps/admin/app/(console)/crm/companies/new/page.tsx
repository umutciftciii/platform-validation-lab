import type { Metadata } from "next";
import { ADMIN_CRM_OWNERS_API, CrmOwnersResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../../../components/catalog/parts";
import { CompanyForm } from "../../../../../components/crm/company-form";
import { EmptyState, ErrorState, Panel } from "../../../../../components/ui";
import { countryOptions } from "../../../../../lib/crm-view";
import { getAdminLocale, getTranslator } from "../../../../../lib/i18n/server";
import { serverRead } from "../../../../../lib/server-api";
import { requireStaffSession } from "../../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("crm.create.title") };
}

/** CRM-1 (ADR-032): a new company on a site where the caller holds crm:manage. */
export default async function NewCompanyPage() {
  const session = await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const res = await serverRead(ADMIN_CRM_OWNERS_API, CrmOwnersResponseSchema);
  const back = { href: "/crm/companies", label: t("crm.detail.back") };
  if (!res.ok || res.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="building" title={t("crm.create.title")} back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {!res.ok && res.status !== 403 ? (
            <ErrorState title={t("crm.list.loadError")}>{t("crm.common.tryAgainLater")}</ErrorState>
          ) : (
            <EmptyState icon="shield" title={t("crm.create.noSites")}>
              {t("crm.create.noSitesText")}
            </EmptyState>
          )}
        </div>
      </div>
    );
  }
  const { sites } = res.data;
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="building"
        title={t("crm.create.title")}
        description={t("crm.create.description")}
        back={back}
      />
      <Panel id="new-company" title={t("crm.detail.profile")} className="max-w-4xl">
        <CompanyForm
          mode="create"
          sites={sites.map((s) => s.site)}
          ownersBySite={Object.fromEntries(sites.map((s) => [s.site.id, s.owners]))}
          viewerId={session.user.id}
          countries={countryOptions(locale)}
        />
      </Panel>
    </div>
  );
}
