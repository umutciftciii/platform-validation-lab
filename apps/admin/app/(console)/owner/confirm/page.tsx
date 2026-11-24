import type { Metadata } from "next";
import { PageHeader } from "../../../../components/catalog/parts";
import { ConfirmDesignation } from "../../../../components/owner/owner-actions";
import { Panel } from "../../../../components/ui";
import { getTranslator } from "../../../../lib/i18n/server";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("owner.confirm.title") };
}

/**
 * One-time confirmation of the system owner designation (DP-110, ADR-018 D5). The operator's link
 * carries the token in the URL fragment (`#t=…`), which never reaches a server; the signed-in
 * person confirms with the current password and a fresh authenticator code. The API refuses
 * anyone the operator did not name, and any second designation.
 */
export default async function ConfirmOwnerPage() {
  await requireStaffSession();
  const t = await getTranslator();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="shield"
        title={t("owner.confirm.title")}
        description={t("owner.confirm.description")}
      />
      <Panel id="confirm" title={t("owner.confirm.panel")}>
        <ConfirmDesignation />
      </Panel>
    </div>
  );
}
