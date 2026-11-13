// DP-U: the console's server-side session lookup goes through the proxy contract and fails closed.
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProxyConfig } from "../lib/api-proxy";
import { lookupStaffSession, SESSION_PATH, SessionLookupError } from "../lib/session";

const KEY = randomBytes(32).toString("base64url");
const CONFIG: ProxyConfig = { apiUrl: "http://api.internal:3000", proxyKey: KEY, trustedHops: 0 };
const TOKEN = randomBytes(32).toString("base64url");

const SESSION = {
  user: { id: randomUUID(), email: "staff@example.com", displayName: "Example Staff" },
  mfaVerifiedAt: "2026-11-11T09:00:00.000Z",
  stepUpValidUntil: "2026-11-11T09:10:00.000Z",
  idleExpiresAt: "2026-11-11T09:30:00.000Z",
  absoluteExpiresAt: "2026-11-11T21:00:00.000Z",
};

function upstream(status: number, body: unknown = SESSION) {
  const seen: Array<{ url: string; init: RequestInit & { headers: Headers } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init: init as RequestInit & { headers: Headers } });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { seen, deps: { fetch: fetchImpl, log: () => {} } };
}

describe("lookupStaffSession", () => {
  it("returns null without calling the API when there is no session cookie", async () => {
    const { seen, deps } = upstream(200);
    expect(await lookupStaffSession({ sessionToken: undefined }, CONFIG, deps)).toBeNull();
    expect(await lookupStaffSession({ sessionToken: "  " }, CONFIG, deps)).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("asks the API's session endpoint through the proxy, with only the session cookie", async () => {
    const { seen, deps } = upstream(200);
    const session = await lookupStaffSession(
      { sessionToken: TOKEN, userAgent: "Vitest", forwardedFor: "203.0.113.9" },
      CONFIG,
      deps,
    );
    expect(session?.user.email).toBe("staff@example.com");
    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.url).toBe(`${CONFIG.apiUrl}${SESSION_PATH}`);
    expect(call.init.method).toBe("GET");
    expect(call.init.headers.get("cookie")).toBe(`__Host-dp_admin_session=${TOKEN}`);
    expect(call.init.headers.get("x-dp-proxy-key")).toBe(KEY);
    expect(call.init.headers.get("user-agent")).toBe("Vitest");
    // 0 trusted hops locally: no client IP is derived from a forwarded header.
    expect(call.init.headers.get("x-dp-client-ip")).toBeNull();
  });

  it.each([401, 403])("treats %i as signed out", async (status) => {
    const { deps } = upstream(status, { error: { code: "AUTH_SESSION_REQUIRED" } });
    expect(await lookupStaffSession({ sessionToken: TOKEN }, CONFIG, deps)).toBeNull();
  });

  it.each([500, 502, 429])(
    "throws on an unexpected status %i instead of signing in",
    async (status) => {
      const { deps } = upstream(status, {});
      await expect(
        lookupStaffSession({ sessionToken: TOKEN }, CONFIG, deps),
      ).rejects.toBeInstanceOf(SessionLookupError);
    },
  );

  it("throws when a 200 answer does not match the session contract", async () => {
    const { deps } = upstream(200, { ...SESSION, admin: true });
    await expect(lookupStaffSession({ sessionToken: TOKEN }, CONFIG, deps)).rejects.toThrow(
      /did not match the contract/,
    );
  });

  it("throws (502 from the proxy) when the API is unreachable", async () => {
    const deps = {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      log: () => {},
    };
    await expect(lookupStaffSession({ sessionToken: TOKEN }, CONFIG, deps)).rejects.toThrow(
      /status 502/,
    );
  });
});
