// F1-002 Group 2: the admin Route Handler's proxy contract (design 2.4), against a fake upstream.
// Covers AC-PX-6, NT-P3, NT-P4, NT-P5, NT-P6 and the proxy part of AC-PX-7 / AC-SEC-2.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clientIpFrom,
  loadProxyConfig,
  MAX_BODY_BYTES,
  proxyRequest,
  type ProxyConfig,
} from "../lib/api-proxy";

const KEY = randomBytes(32).toString("base64url");
const CONFIG: ProxyConfig = { apiUrl: "http://api.internal:3000", proxyKey: KEY, trustedHops: 1 };
const ORIGIN = "https://admin.dreampetroleum.com";

interface Seen {
  url: string;
  init: RequestInit & { headers: Headers };
}

function upstream(response: () => Response) {
  const seen: Seen[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init: init as Seen["init"] });
    return response();
  }) as unknown as typeof fetch;
  return { seen, logs, deps: { fetch: fetchImpl, log: (l: string) => logs.push(l) } };
}

const ok = () =>
  new Response(JSON.stringify({ next: "mfa" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function req(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

describe("configuration", () => {
  it("needs the API URL and a full-length key; https outside local development", () => {
    const base = { DP_API_URL: "http://api:3000", DP_PROXY_KEY_ADMIN: KEY };
    expect(loadProxyConfig(base)).toEqual({
      apiUrl: "http://api:3000",
      proxyKey: KEY,
      trustedHops: 0,
    });
    expect(() => loadProxyConfig({ ...base, DP_PROXY_KEY_ADMIN: "short" })).toThrow(
      /DP_PROXY_KEY_ADMIN/,
    );
    expect(() => loadProxyConfig({ ...base, DP_API_URL: undefined })).toThrow(/DP_API_URL/);
    expect(() => loadProxyConfig({ ...base, DP_DEPLOY_ENV: "production" })).toThrow(/https/);
    expect(
      loadProxyConfig({ ...base, DP_API_URL: "https://api.internal", DP_DEPLOY_ENV: "production" })
        .apiUrl,
    ).toBe("https://api.internal");
    expect(() => loadProxyConfig({ ...base, DP_TRUSTED_PROXY_HOPS: "-1" })).toThrow(/HOPS/);
    try {
      loadProxyConfig({ ...base, DP_PROXY_KEY_ADMIN: `${KEY.slice(0, 20)}` });
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY.slice(0, 20));
    }
  });
});

describe("paths and methods (AC-PX-6)", () => {
  const refused = [
    "/api/v1/auth/member/login",
    "/api/v1/health",
    "/api/v2/auth/staff/login",
    "/api/v1/auth/staff",
    "/api/v1/auth/staff/../../health",
    "/api/v1/admin/%2e%2e/x",
    "/api/v1/auth/staffx/login",
  ];
  for (const path of refused) {
    it(`404 for ${path}, without calling the API`, async () => {
      const u = upstream(ok);
      const res = await proxyRequest(req(path), CONFIG, u.deps);
      expect(res.status).toBe(404);
      expect(u.seen).toHaveLength(0);
    });
  }

  it("404 for methods outside GET, POST, DELETE", async () => {
    const u = upstream(ok);
    const res = await proxyRequest(
      req("/api/v1/auth/staff/session", { method: "PUT" }),
      CONFIG,
      u.deps,
    );
    expect(res.status).toBe(404);
    expect(u.seen).toHaveLength(0);
  });

  it("forwards allowed paths with their query string to the API", async () => {
    const u = upstream(ok);
    await proxyRequest(req("/api/v1/admin/users/x/unlock?probe=1"), CONFIG, u.deps);
    expect(u.seen[0]?.url).toBe("http://api.internal:3000/api/v1/admin/users/x/unlock?probe=1");
  });
});

describe("headers (NT-P3)", () => {
  it("drops client-supplied X-DP-*, forwarding and other headers; adds its own", async () => {
    const u = upstream(ok);
    const spoof = randomBytes(32).toString("base64url");
    await proxyRequest(
      req("/api/v1/auth/staff/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@example.com", password: "x" }),
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          accept: "application/json",
          "user-agent": "test-agent",
          "accept-language": "nl",
          "x-dp-proxy-key": spoof,
          "x-dp-client-ip": "198.51.100.66",
          "x-dp-request-id": "spoofed-request-id",
          "x-forwarded-for": "198.51.100.66, 203.0.113.7",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "http",
          forwarded: "for=198.51.100.66;host=evil.example",
          "x-real-ip": "198.51.100.66",
          via: "1.1 evil",
          authorization: "Bearer stolen",
          "x-custom": "1",
        },
      }),
      CONFIG,
      u.deps,
    );
    const sent = u.seen[0]!.init.headers;
    const names = [...sent.keys()].sort();
    expect(names).toEqual(
      [
        "accept",
        "accept-language",
        "content-type",
        "origin",
        "sec-fetch-site",
        "user-agent",
        "x-dp-client-ip",
        "x-dp-proxy-key",
        "x-dp-request-id",
      ].sort(),
    );
    expect(sent.get("x-dp-proxy-key")).toBe(KEY);
    expect(sent.get("x-dp-client-ip")).toBe("203.0.113.7"); // one trusted hop: the edge's entry
    expect(sent.get("x-dp-request-id")).not.toBe("spoofed-request-id");
    expect(u.seen[0]!.init.redirect).toBe("manual");
  });

  it("takes the client IP from the trusted hop only", () => {
    expect(clientIpFrom("1.1.1.1, 2.2.2.2, 3.3.3.3", 1)).toBe("3.3.3.3");
    expect(clientIpFrom("1.1.1.1, 2.2.2.2, 3.3.3.3", 2)).toBe("2.2.2.2");
    expect(clientIpFrom("1.1.1.1", 0)).toBeNull();
    expect(clientIpFrom("not-an-ip", 1)).toBeNull();
    expect(clientIpFrom(null, 1)).toBeNull();
    expect(clientIpFrom("1.1.1.1", 3)).toBeNull();
  });
});

describe("cookies (NT-P4)", () => {
  it("forwards only the admin cookies and passes back only their Set-Cookie", async () => {
    const u = upstream(() => {
      const h = new Headers({ "content-type": "application/json" });
      h.append(
        "set-cookie",
        "__Host-dp_admin_session=abc; Path=/; Secure; HttpOnly; SameSite=Strict",
      );
      h.append("set-cookie", "__Host-dp_member_session=evil; Path=/; Secure; HttpOnly");
      h.append("set-cookie", "tracking=1; Path=/");
      return new Response("{}", { status: 200, headers: h });
    });
    const res = await proxyRequest(
      req("/api/v1/auth/staff/session", {
        headers: {
          cookie:
            "__Host-dp_admin_session=s1; __Host-dp_member_session=m; analytics=x; __Host-dp_admin_challenge=c1",
        },
      }),
      CONFIG,
      u.deps,
    );
    expect(u.seen[0]!.init.headers.get("cookie")).toBe(
      "__Host-dp_admin_session=s1; __Host-dp_admin_challenge=c1",
    );
    expect(res.headers.getSetCookie()).toEqual([
      "__Host-dp_admin_session=abc; Path=/; Secure; HttpOnly; SameSite=Strict",
    ]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends no cookie header when no admin cookie is present", async () => {
    const u = upstream(ok);
    await proxyRequest(
      req("/api/v1/auth/staff/session", { headers: { cookie: "a=b" } }),
      CONFIG,
      u.deps,
    );
    expect(u.seen[0]!.init.headers.has("cookie")).toBe(false);
  });
});

describe("bodies (NT-P5)", () => {
  it("413 above 16 KB, also without a Content-Length", async () => {
    const u = upstream(ok);
    const big = JSON.stringify({ email: "a@example.com", password: "x".repeat(MAX_BODY_BYTES) });
    const declared = await proxyRequest(
      req("/api/v1/auth/staff/login", {
        method: "POST",
        body: big,
        headers: { "content-type": "application/json", "content-length": String(big.length) },
      }),
      CONFIG,
      u.deps,
    );
    expect(declared.status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const streamed = await proxyRequest(
      req("/api/v1/auth/staff/login", {
        method: "POST",
        body: stream,
        headers: { "content-type": "application/json" },
        duplex: "half",
      } as RequestInit),
      CONFIG,
      u.deps,
    );
    expect(streamed.status).toBe(413);
    expect(u.seen).toHaveLength(0);
  });

  it("415 for anything but JSON", async () => {
    const u = upstream(ok);
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await proxyRequest(
        req("/api/v1/auth/staff/login", {
          method: "POST",
          body: "a=b",
          headers: { "content-type": type },
        }),
        CONFIG,
        u.deps,
      );
      expect(res.status).toBe(415);
    }
    expect(u.seen).toHaveLength(0);
  });
});

describe("upstream failures and logs (NT-P6)", () => {
  it("502 with a generic body when the API is unreachable; the log has no key, cookie or body", async () => {
    const secretPassword = `Pw-${randomBytes(12).toString("base64url")}`;
    const secretBody = JSON.stringify({ email: "a@example.com", password: secretPassword });
    const deps = {
      fetch: (async () => {
        throw new Error(`connect ECONNREFUSED with ${KEY}`);
      }) as unknown as typeof fetch,
      logs: [] as string[],
    };
    const res = await proxyRequest(
      req("/api/v1/auth/staff/login", {
        method: "POST",
        body: secretBody,
        headers: {
          "content-type": "application/json",
          cookie: "__Host-dp_admin_session=SESSIONVALUE",
        },
      }),
      CONFIG,
      { fetch: deps.fetch, log: (l) => deps.logs.push(l) },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_GATEWAY");
    const text = JSON.stringify(body) + deps.logs.join("\n");
    for (const secret of [KEY, "SESSIONVALUE", secretPassword, "ECONNREFUSED"]) {
      expect(text).not.toContain(secret);
    }
    expect(deps.logs).toHaveLength(1);
  });

  it("refuses an upstream redirect", async () => {
    const u = upstream(
      () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    );
    const res = await proxyRequest(req("/api/v1/auth/staff/session"), CONFIG, u.deps);
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes status, JSON body and Retry-After through", async () => {
    const u = upstream(
      () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "8", "x-internal": "1" },
        }),
    );
    const res = await proxyRequest(req("/api/v1/auth/staff/session"), CONFIG, u.deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("8");
    expect(res.headers.get("x-internal")).toBeNull();
  });
});
