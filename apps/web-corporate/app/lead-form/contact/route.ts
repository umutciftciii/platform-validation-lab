import { handleContactMessage } from "@/lib/contact-api";

/**
 * COM-4 (DP-030): the corporate contact form. Forwarded to the platform API with this site's key;
 * the message is stored on the sender's CORPORATE lead (CRM). The answer says only whether it was
 * received.
 */
export async function POST(request: Request) {
  return handleContactMessage(request);
}
