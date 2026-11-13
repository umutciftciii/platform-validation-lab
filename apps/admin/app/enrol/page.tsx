import type { Metadata } from "next";
import { AuthFrame } from "../../components/auth/auth-frame";
import { EnrolFlow } from "../../components/auth/enrol-flow";

export const metadata: Metadata = { title: "Account setup", referrer: "no-referrer" };

/**
 * Activation, invitation, operator recovery (also the system owner's) and MFA re-enrolment with
 * a single-use link `/enrol#t=…` (DP-114). Public: the link itself is the credential, the API
 * checks it at every step. The server renders only the frame; the token never reaches it.
 */
export default function EnrolPage() {
  return (
    <AuthFrame
      width="wide"
      railTitle="Your access, set up securely."
      railText="A password only you know and an authenticator on your phone protect every sign-in to the console."
    >
      <EnrolFlow />
    </AuthFrame>
  );
}
