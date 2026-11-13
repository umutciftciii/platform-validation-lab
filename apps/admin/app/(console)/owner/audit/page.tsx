import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OwnerOverviewResponseSchema } from "@dream/contracts";
import { PageHeader } from "../../../../components/catalog/parts";
import { ProtectedAuditLog } from "../../../../components/owner/owner-actions";
import { Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Protected audit trail" };

/**
 * The PROTECTED audit stream (DP-110, ADR-018 D6): the owner's actions and every action aimed at
 * the owner account, newest first. Reading it needs a fresh authenticator confirmation, so the
 * list loads in the browser; the owner check happens here first (404 for everyone else).
 */
export default async function ProtectedAuditPage() {
  await requireStaffSession();
  const res = await serverRead("/api/v1/admin/owner/overview", OwnerOverviewResponseSchema);
  if (!res.ok) notFound();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="audit"
        title="Protected audit trail"
        description="Never shown on staff screens and never deleted. Each event carries its place in the hash chain."
        back={{ href: "/owner", label: "Owner console" }}
      />
      <Panel id="events" title="Events">
        <ProtectedAuditLog />
      </Panel>
    </div>
  );
}
