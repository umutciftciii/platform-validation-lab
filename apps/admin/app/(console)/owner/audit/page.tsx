import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OwnerOverviewResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { ProtectedAuditLog } from "../../../../components/owner/owner-actions";
import { Panel } from "../../../../components/ui";
import { getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("owner.audit.title") };
}

/**
 * The PROTECTED audit stream (DP-110, ADR-018 D6): the owner's actions and every action aimed at
 * the owner account, newest first. Reading it needs a fresh authenticator confirmation, so the
 * list loads in the browser; the owner check happens here first (404 for everyone else).
 */
export default async function ProtectedAuditPage() {
  await requireStaffSession();
  const res = await serverRead("/api/v1/admin/owner/overview", OwnerOverviewResponseSchema);
  if (!res.ok) notFound();
  const t = await getTranslator();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="audit"
        title={t("owner.audit.title")}
        description={t("owner.audit.description")}
        back={{ href: "/owner", label: t("owner.audit.back") }}
      />
      <Panel id="events" title={t("owner.audit.events")}>
        <ProtectedAuditLog />
      </Panel>
    </div>
  );
}
