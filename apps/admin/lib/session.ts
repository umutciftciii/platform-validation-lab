/**
 * Server-side staff session lookup for the admin console (DP-U).
 *
 * The console makes no security decision of its own: it asks the API (GET
 * /api/v1/auth/staff/session) through the same proxy function the browser uses, so the proxy key,
 * cookie allow-list and header stripping stay in one place (lib/api-proxy.ts). Only the admin
 * session cookie is forwarded. Any answer other than a valid session is "signed out"; an
 * unreachable API is an error, never a silent sign-in.
 */
import {
  ADMIN_SESSION_COOKIE,
  StaffSessionResponseSchema,
  type StaffSessionResponse,
} from "@dream/contracts";
import { proxyRequest, type ProxyConfig, type ProxyDeps } from "./api-proxy";

export const SESSION_PATH = "/api/v1/auth/staff/session";
// Only used to build a Request object; proxyRequest reads the path, never this origin.
const INTERNAL_ORIGIN = "http://admin.internal";
/** Upstream answers that mean "no valid session": treat as signed out. */
const SIGNED_OUT = new Set([401, 403]);

export class SessionLookupError extends Error {
  override name = "SessionLookupError";
}

export interface SessionRequestContext {
  /** Value of the __Host-dp_admin_session cookie, if any. */
  sessionToken: string | undefined;
  userAgent?: string | null;
  forwardedFor?: string | null;
}

export async function lookupStaffSession(
  context: SessionRequestContext,
  config: ProxyConfig,
  deps: ProxyDeps,
): Promise<StaffSessionResponse | null> {
  const token = context.sessionToken?.trim();
  if (!token) return null;

  const headers = new Headers({
    accept: "application/json",
    cookie: `${ADMIN_SESSION_COOKIE}=${token}`,
  });
  if (context.userAgent) headers.set("user-agent", context.userAgent);
  if (context.forwardedFor) headers.set("x-forwarded-for", context.forwardedFor);

  const response = await proxyRequest(
    new Request(`${INTERNAL_ORIGIN}${SESSION_PATH}`, { method: "GET", headers }),
    config,
    deps,
  );
  if (SIGNED_OUT.has(response.status)) return null;
  if (response.status !== 200) {
    throw new SessionLookupError(`session lookup failed with status ${response.status}`);
  }
  const parsed = StaffSessionResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new SessionLookupError("session response did not match the contract");
  return parsed.data;
}
