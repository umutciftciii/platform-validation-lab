/**
 * Next.js binding of lib/session.ts: reads the request's cookie and headers, memoises the lookup
 * per request with React's cache(), and redirects to /login when there is no valid session.
 * Every protected layout and page calls requireStaffSession() itself, because a layout is not
 * re-rendered on client-side navigation.
 */
import { ADMIN_SESSION_COOKIE, type StaffSessionResponse } from "@dream/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadProxyConfig, type ProxyConfig } from "./api-proxy";
import { lookupStaffSession } from "./session";

let config: ProxyConfig | undefined;

export const getStaffSession = cache(async (): Promise<StaffSessionResponse | null> => {
  config ??= loadProxyConfig(process.env);
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return lookupStaffSession(
    {
      sessionToken: jar.get(ADMIN_SESSION_COOKIE)?.value,
      userAgent: h.get("user-agent"),
      forwardedFor: h.get("x-forwarded-for"),
    },
    config,
    { fetch: globalThis.fetch, log: (line) => console.error(line) },
  );
});

export async function requireStaffSession(): Promise<StaffSessionResponse> {
  const session = await getStaffSession();
  if (!session) redirect("/login");
  return session;
}
