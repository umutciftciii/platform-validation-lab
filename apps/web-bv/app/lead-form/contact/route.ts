import { handleContactMessage } from "@/lib/contact-api";

/**
 * DP-151: the contact form. Forwarded to the platform API with this site's key; the message is
 * stored on the sender's lead. The answer says only whether it was received.
 */
export async function POST(request: Request) {
  return handleContactMessage(request);
}
