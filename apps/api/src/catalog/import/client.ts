/**
 * DP-157: a minimal client of the admin catalogue API, exactly as the admin console's Route
 * Handlers call it: admin proxy key, the operator's own staff session cookie and the admin
 * origin. Authorisation, audit events, database triggers and validation therefore apply to every
 * call of the import as to a person working in the console; the import has no other access.
 */
export interface AdminApiConfig {
  /** Base URL of the API, e.g. http://api:3001 (no trailing slash needed). */
  baseUrl: string;
  proxyKey: string;
  /** The value of the operator's __Host-dp_admin_session cookie. */
  sessionToken: string;
  /** An allowed admin origin (DP_ALLOWED_ORIGINS_ADMIN / DP_ADMIN_BASE_URL). */
  origin: string;
}

export class AdminApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} -> ${status} ${JSON.stringify(body)?.slice(0, 500) ?? ""}`);
  }
}

export interface AdminApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function adminApi(cfg: AdminApiConfig, fetchImpl: typeof fetch = fetch): AdminApi {
  const base = `${cfg.baseUrl.replace(/\/+$/, "")}/api/v1/admin/catalog`;
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": cfg.proxyKey,
      "x-dp-client-ip": "127.0.0.1",
      cookie: `__Host-dp_admin_session=${cfg.sessionToken}`,
    };
    if (method === "POST") {
      headers["origin"] = cfg.origin;
      headers["content-type"] = "application/json";
    }
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      redirect: "error",
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text.slice(0, 200);
    }
    if (!res.ok) throw new AdminApiError(method, path, res.status, parsed);
    return parsed as T;
  }
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body: unknown) => call<T>("POST", path, body),
  };
}
