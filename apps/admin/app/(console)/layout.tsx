import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProposalContextResponseSchema } from "@dream/contracts";
import { AppShell } from "../../components/shell/app-shell";
import { COMPANY_REVIEW_PATH, reviewOnlyAllows } from "../../lib/proposals-view";
import { serverRead } from "../../lib/server-api";
import { requireStaffSession } from "../../lib/server-session";
import { getTranslator } from "../../lib/i18n/server";
import { PATHNAME_HEADER } from "../../lib/route-guard";

// Every console route depends on the request's session cookie.
export const dynamic = "force-dynamic";

const ENVIRONMENTS = ["local", "staging", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];
const isEnvironment = (value: string): value is Environment =>
  (ENVIRONMENTS as readonly string[]).includes(value);

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffSession();
  const t = await getTranslator();
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
      environmentLabel={isEnvironment(deployEnv) ? t(`shell.environments.${deployEnv}`) : deployEnv}
      isOwner={session.isSystemOwner === true}
      reviewOnly={reviewOnly}
      features={{ aiCenter: session.features?.aiCenter === true }}
    >
      {children}
    </AppShell>
  );
}
