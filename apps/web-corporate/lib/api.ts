/**
 * COM-1: the platform API as dreampetroleum.com reads it — server side only, with this site's own
 * proxy key (`DP_PROXY_KEY_WEB_CORPORATE`, never a NEXT_PUBLIC_ variable); the API derives the
 * site from the key. Same rules as web-bv's `catalogConfig` (apps/web-bv/lib/catalog-api.ts):
 * https outside local development, a key of the expected form, otherwise not configured (null).
 */
const KEY = /^[A-Za-z0-9_-]{43,}$/;

export interface ApiConfig {
  apiUrl: string;
  proxyKey: string;
}

export function apiConfig(env: Record<string, string | undefined> = process.env): ApiConfig | null {
  const apiUrl = env["DP_API_URL"]?.trim();
  const proxyKey = env["DP_PROXY_KEY_WEB_CORPORATE"]?.trim() ?? "";
  if (!apiUrl || !KEY.test(proxyKey)) return null;
  try {
    const url = new URL(apiUrl);
    const local = (env["DP_DEPLOY_ENV"]?.trim() || "local") === "local";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return { apiUrl: url.origin, proxyKey };
  } catch {
    return null;
  }
}

export const TIMEOUT_MS = 5_000;

/** A GET of the public API with this site's key; null on a network failure (logged). */
export async function apiGet(
  path: string,
  config: ApiConfig | null = apiConfig(),
): Promise<Response | null> {
  if (!config) return null;
  try {
    return await fetch(`${config.apiUrl}${path}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error(`public api: request failed (network): ${path.split("?")[0]}`);
    return null;
  }
}
