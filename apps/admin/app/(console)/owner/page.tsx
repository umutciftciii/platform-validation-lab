import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerOverviewResponseSchema } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import { ChainStatus, ModuleSwitch } from "../../../components/owner/owner-actions";
import { ErrorState, Panel, StatusPill, buttonStyles } from "../../../components/ui";
import { ADMIN_TIME_ZONE } from "../../../lib/i18n/config";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import { ownerModuleDescription, ownerModuleName } from "../../../lib/owner-client";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("owner.console.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
};

/**
 * System owner console (DP-110, ADR-018). The API answers 404 to anyone but the designated owner,
 * so for everyone else this route does not exist. Module switches and the protected audit trail
 * need a fresh authenticator confirmation; the components ask for it.
 */
export default async function OwnerPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const res = await serverRead("/api/v1/admin/owner/overview", OwnerOverviewResponseSchema);
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) notFound();
    return (
      <div className="space-y-8">
        <PageHeader icon="shield" title={t("owner.console.title")} />
        <ErrorState title={t("owner.console.loadError")}>
          {t("owner.console.loadErrorText")}
        </ErrorState>
      </div>
    );
  }
  const { owner, sites, modules, chain } = res.data;
  // DP-287: platform modules (the AI Center) have one platform-wide switch, shown on their own.
  const platform = modules.filter((m) => m.scope === "PLATFORM");
  const optional = modules.filter((m) => !m.isCore && m.scope !== "PLATFORM");
  const core = modules.filter((m) => m.isCore);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="shield"
        title={t("owner.console.title")}
        description={t("owner.console.description")}
        actions={
          <Link href="/owner/audit" className={buttonStyles.secondary}>
            {t("owner.console.auditLink")}
          </Link>
        }
      />

      <Panel id="owner" title={t("owner.console.ownerPanel")}>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-3">{t("owner.console.account")}</dt>
            <dd className="mt-0.5 font-medium text-ink">{owner.displayName ?? owner.email}</dd>
            <dd className="text-ink-3">{owner.email}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("owner.console.designated")}</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {dateTimeFormat(locale, DATE_OPTIONS).format(new Date(owner.designatedAt))}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("owner.console.transfer")}</dt>
            <dd className="mt-0.5">
              <StatusPill tone="petrol">{t("owner.console.notTransferable")}</StatusPill>
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel
        id="modules"
        title={t("owner.console.modulesPanel")}
        description={t("owner.console.modulesDescription")}
        bodyClassName="px-0! pb-1! pt-2!"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="px-5 py-2 font-medium sm:px-6">
                  {t("owner.console.moduleColumn")}
                </th>
                {sites.map((s) => (
                  <th key={s.id} scope="col" className="px-3 py-2 font-medium">
                    {SITE_SHORT[s.key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {optional.map((m) => (
                <tr key={m.key} className="border-t border-line align-top">
                  <th scope="row" className="px-5 py-3 text-left font-normal sm:px-6">
                    <span className="font-medium text-ink">{ownerModuleName(m, t)}</span>
                    <span className="block text-ink-3">{ownerModuleDescription(m, t)}</span>
                  </th>
                  {sites.map((s) => {
                    const state = m.sites.find((x) => x.siteId === s.id);
                    return (
                      <td key={s.id} className="px-3 py-3">
                        <ModuleSwitch module={m} site={s} enabled={state?.enabled ?? false} />
                        {state?.reason ? (
                          <p className="mt-1 text-xs text-ink-3">
                            {t("owner.console.lastReason", { reason: state.reason })}
                          </p>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3 sm:px-6">
          {t("owner.console.core", {
            modules: core.map((m) => ownerModuleName(m, t)).join(", "),
          })}
        </p>
      </Panel>

      {platform.length > 0 ? (
        <Panel
          id="platform-modules"
          title={t("owner.console.platformPanel")}
          description={t("owner.console.platformDescription")}
          bodyClassName="px-0! pb-1! pt-2!"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-ink-3">
                  <th scope="col" className="px-5 py-2 font-medium sm:px-6">
                    {t("owner.console.moduleColumn")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("owner.console.platformState")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {platform.map((m) => (
                  <tr key={m.key} className="border-t border-line align-top">
                    <th scope="row" className="px-5 py-3 text-left font-normal sm:px-6">
                      <span className="font-medium text-ink">{ownerModuleName(m, t)}</span>
                      <span className="block text-ink-3">{ownerModuleDescription(m, t)}</span>
                    </th>
                    <td className="px-3 py-3">
                      <ModuleSwitch module={m} enabled={m.platform?.enabled === true} />
                      {m.platform?.reason ? (
                        <p className="mt-1 text-xs text-ink-3">
                          {t("owner.console.lastReason", { reason: m.platform.reason })}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel
        id="chain"
        title={t("owner.console.chainPanel")}
        description={t("owner.console.chainDescription")}
      >
        <ChainStatus initial={chain} />
      </Panel>
    </div>
  );
}
