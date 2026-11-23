import type { Metadata } from "next";
import { AuthFrame } from "../../components/auth/auth-frame";
import { ResetFlow } from "../../components/auth/reset-flow";
import { getTranslator } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("reset.metaTitle"), referrer: "no-referrer" };
}

/**
 * Password reset with the operator's single-use link `/reset#t=…` (DP-114); the second factor is
 * still required. Public: the link is the credential and the API checks it.
 */
export default function ResetPage() {
  return (
    <AuthFrame>
      <ResetFlow />
    </AuthFrame>
  );
}
