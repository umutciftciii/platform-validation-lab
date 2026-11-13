import type { ReactNode } from "react";
import { AppShell } from "../../components/shell/app-shell";
import { requireStaffSession } from "../../lib/server-session";

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
  return (
    <AppShell
      user={user}
      environmentLabel={ENVIRONMENT_LABELS[deployEnv] ?? deployEnv}
      isOwner={session.isSystemOwner === true}
    >
      {children}
    </AppShell>
  );
}
