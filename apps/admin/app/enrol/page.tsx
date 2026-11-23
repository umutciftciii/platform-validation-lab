import type { Metadata } from "next";
import { AuthFrame } from "../../components/auth/auth-frame";
import { EnrolFlow } from "../../components/auth/enrol-flow";
import { getTranslator } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator())("enrol.metaTitle"), referrer: "no-referrer" };
}

/**
 * Activation, invitation, operator recovery (also the system owner's) and MFA re-enrolment with
 * a single-use link `/enrol#t=…` (DP-114). Public: the link itself is the credential, the API
 * checks it at every step. The server renders only the frame; the token never reaches it.
 */
export default function EnrolPage() {
  return (
    <AuthFrame width="wide" rail="enrol">
      <EnrolFlow />
    </AuthFrame>
  );
}
