import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProposalContextResponseSchema } from "@dream/contracts";
import { AppShell } from "../../components/shell/app-shell";
import { COMPANY_REVIEW_PATH, reviewOnlyAllows } from "../../lib/proposals-view";
import { serverRead } from "../../lib/server-api";
import { requireStaffSession } from "../../lib/server-session";
import { PATHNAME_HEADER } from "../../lib/route-guard";

// Every console route depends on the request's session cookie.
export const dynamic = "force-dynamic";

const ENVIRONMENT_LABELS: Readonly<Record<string, string>> = {
  local: "Local development",
  staging: "Staging",
  production: "Production",
};

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffSession();
  const deployEnv = process.env["DP_DEPLOY_ENV"]?.trim() || "local";
  const user = {
    name: session.user.displayName ?? session.user.email.split("@")[0] ?? session.user.email,
    email: session.user.email,
  };
  // DP-172: a company reviewer (review-only permissions) sees and opens only the company review.
  // Presentation only: the API refuses every other module for that role anyway.
  const scope = await serverRead(
    "/api/v1/admin/catalog/proposals/context",
    ProposalContextResponseSchema,
  );
  const reviewOnly = scope.ok && scope.data.reviewOnly;
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  if (reviewOnly && !reviewOnlyAllows(pathname)) redirect(COMPANY_REVIEW_PATH);
  return (
    <AppShell
      user={user}
      environmentLabel={ENVIRONMENT_LABELS[deployEnv] ?? deployEnv}
      isOwner={session.isSystemOwner === true}
      reviewOnly={reviewOnly}
    >
      {children}
    </AppShell>
  );
}
