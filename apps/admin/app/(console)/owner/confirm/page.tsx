import type { Metadata } from "next";
import { PageHeader } from "../../../../components/catalog/parts";
import { ConfirmDesignation } from "../../../../components/owner/owner-actions";
import { Panel } from "../../../../components/ui";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Confirm owner designation" };

/**
 * One-time confirmation of the system owner designation (DP-110, ADR-018 D5). The operator's link
 * carries the token in the URL fragment (`#t=…`), which never reaches a server; the signed-in
 * person confirms with the current password and a fresh authenticator code. The API refuses
 * anyone the operator did not name, and any second designation.
 */
export default async function ConfirmOwnerPage() {
  await requireStaffSession();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="shield"
        title="Confirm owner designation"
        description="You were named as the system owner. After confirmation your account holds God Mode, which cannot be transferred to anyone else."
      />
      <Panel id="confirm" title="Confirm with your password and authenticator">
        <ConfirmDesignation />
      </Panel>
    </div>
  );
}
