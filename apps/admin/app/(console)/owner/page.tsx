import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerOverviewResponseSchema } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import { ChainStatus, ModuleSwitch } from "../../../components/owner/owner-actions";
import { ErrorState, Panel, StatusPill, buttonStyles } from "../../../components/ui";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "Owner console" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

/**
 * System owner console (DP-110, ADR-018). The API answers 404 to anyone but the designated owner,
 * so for everyone else this route does not exist. Module switches and the protected audit trail
 * need a fresh authenticator confirmation; the components ask for it.
 */
export default async function OwnerPage() {
  await requireStaffSession();
  const res = await serverRead("/api/v1/admin/owner/overview", OwnerOverviewResponseSchema);
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) notFound();
    return (
      <div className="space-y-8">
        <PageHeader icon="shield" title="Owner console" />
        <ErrorState title="The owner console could not be loaded">
          Try again in a moment.
        </ErrorState>
      </div>
    );
  }
  const { owner, sites, modules, chain } = res.data;
  const optional = modules.filter((m) => !m.isCore);
  const core = modules.filter((m) => m.isCore);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="shield"
        title="Owner console"
        description="God Mode of the system owner. Switch optional modules per site and review the protected audit trail. Only you see this page; it cannot be handed on."
        actions={
          <Link href="/owner/audit" className={buttonStyles.secondary}>
            Protected audit trail
          </Link>
        }
      />

      <Panel id="owner" title="System owner">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-3">Account</dt>
            <dd className="mt-0.5 font-medium text-ink">{owner.displayName ?? owner.email}</dd>
            <dd className="text-ink-3">{owner.email}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Designated</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {DATE.format(new Date(owner.designatedAt))}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Transfer</dt>
            <dd className="mt-0.5">
              <StatusPill tone="petrol">Not transferable</StatusPill>
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel
        id="modules"
        title="Optional modules"
        description="A module that is off keeps its data; its functions stay closed for everyone, you included, until it is switched on again. Every change needs a reason."
        bodyClassName="px-0! pb-1! pt-2!"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="px-5 py-2 font-medium sm:px-6">
                  Module
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
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="block text-ink-3">{m.description}</span>
                  </th>
                  {sites.map((s) => {
                    const state = m.sites.find((x) => x.siteId === s.id);
                    return (
                      <td key={s.id} className="px-3 py-3">
                        <ModuleSwitch module={m} site={s} enabled={state?.enabled ?? false} />
                        {state?.reason ? (
                          <p className="mt-1 text-xs text-ink-3">Last reason: {state.reason}</p>
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
          Always on (core): {core.map((m) => m.name).join(", ")}.
        </p>
      </Panel>

      <Panel
        id="chain"
        title="Protected audit chain"
        description="Your actions and every action aimed at your account are chained with SHA-256 and never shown on staff screens."
      >
        <ChainStatus initial={chain} />
      </Panel>
    </div>
  );
}
