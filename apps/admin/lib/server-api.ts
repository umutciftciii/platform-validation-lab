/**
 * Next.js binding of lib/admin-api.ts for server components: reads the request's session cookie
 * and headers, and sends a signed-out user to the sign-in page.
 */
import { ADMIN_SESSION_COOKIE } from "@dream/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readApi, type ApiRead } from "./admin-api";
import { loadProxyConfig, type ProxyConfig } from "./api-proxy";

let config: ProxyConfig | undefined;

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export type ServerRead<T> = Exclude<ApiRead<T>, { status: 401 }>;

export async function serverRead<T>(path: string, schema: Parser<T>): Promise<ServerRead<T>> {
  config ??= loadProxyConfig(process.env);
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const result = await readApi(
    path,
    schema,
    {
      sessionToken: jar.get(ADMIN_SESSION_COOKIE)?.value,
      userAgent: h.get("user-agent"),
      forwardedFor: h.get("x-forwarded-for"),
    },
    config,
    { fetch: globalThis.fetch, log: (line) => console.error(line) },
  );
  if (!result.ok && result.status === 401) redirect("/login");
  return result as ServerRead<T>;
}
