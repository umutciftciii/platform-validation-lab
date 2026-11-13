/**
 * Server-side reads of the admin API for console pages (PM-1 onwards). Like the session lookup
 * (lib/session.ts), it goes through the same proxy function the browser uses, forwarding only
 * the admin session cookie; the API makes every authorization decision.
 *
 * `readApi` parses the answer with a contract schema. 401 means the session ended: the caller
 * redirects to sign-in. 403 and 404 are returned as values, so a page can render "not allowed"
 * or "not found" without a crash; anything else is an error for the route's error boundary.
 */
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import { proxyRequest, type ProxyConfig, type ProxyDeps } from "./api-proxy";

// Only used to build a Request object; proxyRequest reads the path, never this origin.
const INTERNAL_ORIGIN = "http://admin.internal";

export class AdminApiError extends Error {
  override name = "AdminApiError";
}

export type ApiRead<T> =
  { ok: true; data: T } | { ok: false; status: 401 | 403 | 404; code: string | null };

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface AdminRequestContext {
  sessionToken: string | undefined;
  userAgent?: string | null;
  forwardedFor?: string | null;
}

export async function readApi<T>(
  path: string,
  schema: Parser<T>,
  context: AdminRequestContext,
  config: ProxyConfig,
  deps: ProxyDeps,
): Promise<ApiRead<T>> {
  const token = context.sessionToken?.trim();
  if (!token) return { ok: false, status: 401, code: null };
  const headers = new Headers({
    accept: "application/json",
    cookie: `${ADMIN_SESSION_COOKIE}=${token}`,
  });
  if (context.userAgent) headers.set("user-agent", context.userAgent);
  if (context.forwardedFor) headers.set("x-forwarded-for", context.forwardedFor);
  const response = await proxyRequest(
    new Request(`${INTERNAL_ORIGIN}${path}`, { method: "GET", headers }),
    config,
    deps,
  );
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    return { ok: false, status: response.status, code: body?.error?.code ?? null };
  }
  if (response.status !== 200) {
    throw new AdminApiError(`GET ${path.split("?")[0]} failed with status ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new AdminApiError(`GET ${path.split("?")[0]} did not match the contract`);
  }
  return { ok: true, data: parsed.data };
}
