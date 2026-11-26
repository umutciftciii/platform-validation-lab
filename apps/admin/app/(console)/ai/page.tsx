import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AI_API, AiOverviewResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../components/catalog/parts";
import { ErrorState, Panel, StatusPill } from "../../../components/ui";
import { getTranslator } from "../../../lib/i18n/server";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("ai.metaTitle") };
}

/**
 * DP-287 (ADR-030): Admin > AI Center. It exists only while the system owner keeps AI on and the
 * user may read it (`features.aiCenter`); otherwise this route is a plain 404, and so is the API.
 * DP-287 shows the state and why no AI call is possible yet (no key, model or budget exists before
 * DP-288…DP-290). There is no button: nothing here can start an AI call.
 */
export default async function AiCenterPage() {
  const session = await requireStaffSession();
  if (session.features?.aiCenter !== true) notFound();
  const t = await getTranslator();
  const res = await serverRead(`${AI_API}/overview`, AiOverviewResponseSchema);
  const header = <PageHeader icon="ai" title={t("ai.title")} description={t("ai.description")} />;
  if (!res.ok) {
    // 404 = AI went off meanwhile; 403 = the user may not read it.
    if (res.status === 404 || res.status === 403) notFound();
    return (
      <div className="space-y-8">
        {header}
        <ErrorState title={t("ai.loadError")}>{t("ai.loadErrorText")}</ErrorState>
      </div>
    );
  }
  const { callsPossible, blockers } = res.data;
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <Panel id="ai-state" title={t("ai.statePanel")}>
        <div className="space-y-2 text-sm">
          <StatusPill tone="success">{t("ai.stateOn")}</StatusPill>
          <p className="text-ink-2">{t("ai.stateOnText")}</p>
        </div>
      </Panel>
      <Panel id="ai-calls" title={t("ai.callsPanel")}>
        {callsPossible ? null : (
          <div className="space-y-3 text-sm">
            <StatusPill tone="neutral">{t("ai.callsImpossible")}</StatusPill>
            <p className="text-ink-2">{t("ai.callsImpossibleText")}</p>
            <ul className="space-y-2">
              {blockers.map((b) => (
                <li key={b} className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="amber">{t("ai.blockerMissing")}</StatusPill>
                  <span className="text-ink">{t(`ai.blockers.${b}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
