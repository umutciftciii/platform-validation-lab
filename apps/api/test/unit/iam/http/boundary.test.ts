// F1-002 Group 2: the API side of the proxy trust boundary, without a database or network.
// Covers AC-PX-3, AC-PX-5 (unit), AC-PX-8, NT-P9, NT-P13, NT-L4, NT-C1..3, NT-C4 and the cookie
// separation behind NT-S6/NT-S7.
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ApiConfigError,
  loadApiConfig,
  loadTlsConfig,
  parseOrigin,
} from "../../../../src/iam/http/api-config.js";
import { APP_COOKIES, readCookies } from "../../../../src/iam/http/cookies.js";
import {
  matchProxyKey,
  parseProxyKeys,
  ProxyKeyConfigError,
} from "../../../../src/iam/http/proxy-keys.js";
import { csrfAllows, isHealthPath } from "../../../../src/iam/http/security.middleware.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../src");
const key = () => randomBytes(32).toString("base64url");

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DP_PROXY_KEY_ADMIN: key(),
    DP_PROXY_KEY_WEB_BV: key(),
    DP_PROXY_KEY_WEB_CORPORATE: key(),
    IAM_MFA_ENC_KEYS: `1:${key()}`,
    IAM_HMAC_KEY: key(),
    ...extra,
  };
}

describe("proxy keys (AC-PX-3, NT-P9)", () => {
  it("derives the app and slot from the key alone", () => {
    const e = env({ DP_PROXY_KEY_ADMIN_NEXT: key() });
    const ring = parseProxyKeys(e);
    expect(matchProxyKey(ring, e["DP_PROXY_KEY_ADMIN"])).toEqual({ app: "ADMIN", slot: "current" });
    expect(matchProxyKey(ring, e["DP_PROXY_KEY_ADMIN_NEXT"])).toEqual({
      app: "ADMIN",
      slot: "next",
    });
    expect(matchProxyKey(ring, e["DP_PROXY_KEY_WEB_BV"])).toEqual({
      app: "WEB_BV",
      slot: "current",
    });
    expect(matchProxyKey(ring, key())).toBeNull();
    expect(matchProxyKey(ring, undefined)).toBeNull();
    expect(matchProxyKey(ring, "")).toBeNull();
    expect(matchProxyKey(ring, "x".repeat(10_000))).toBeNull();
  });

  const refused: [string, NodeJS.ProcessEnv, RegExp][] = [
    [
      "a missing admin key",
      env({ DP_PROXY_KEY_ADMIN: undefined }),
      /DP_PROXY_KEY_ADMIN is not set/,
    ],
    ["a missing site key", env({ DP_PROXY_KEY_WEB_CORPORATE: "" }), /WEB_CORPORATE is not set/],
    ["a short key", env({ DP_PROXY_KEY_WEB_BV: "a".repeat(42) }), /at least 43/],
    ["a key that is not base64url", env({ DP_PROXY_KEY_ADMIN: `${key()}+/` }), /base64url/],
    [
      "one key for two apps",
      (() => {
        const k = key();
        return env({ DP_PROXY_KEY_ADMIN: k, DP_PROXY_KEY_WEB_BV: k });
      })(),
      /must differ/,
    ],
    [
      "current = next",
      (() => {
        const k = key();
        return env({ DP_PROXY_KEY_ADMIN: k, DP_PROXY_KEY_ADMIN_NEXT: k });
      })(),
      /must differ/,
    ],
    [
      "next of one app = current of another",
      (() => {
        const e = env();
        return { ...e, DP_PROXY_KEY_WEB_BV_NEXT: e["DP_PROXY_KEY_ADMIN"] };
      })(),
      /must differ/,
    ],
  ];
  for (const [name, e, message] of refused) {
    it(`refuses ${name}, naming the variable but never the value`, () => {
      let error: unknown;
      try {
        parseProxyKeys(e);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ProxyKeyConfigError);
      expect((error as Error).message).toMatch(message);
      for (const v of Object.values(e)) {
        if (v && v.length >= 43) expect((error as Error).message).not.toContain(v);
      }
    });
  }
});

describe("start-up configuration (NT-L4, AC-PX-8, NT-P13)", () => {
  it("loads a complete local configuration with production origins by default", () => {
    const config = loadApiConfig(env());
    expect(config.deployEnv).toBe("local");
    expect(config.tls).toBeNull();
    expect([...config.allowedOrigins.ADMIN]).toEqual(["https://admin.dreampetroleum.com"]);
    expect(config.adminBaseUrl).toBe("https://admin.dreampetroleum.com");
  });

  it("refuses to start without IAM secrets or with a weak HMAC key", () => {
    expect(() => loadApiConfig(env({ IAM_HMAC_KEY: undefined }))).toThrow(
      /IAM_HMAC_KEY is not set/,
    );
    expect(() => loadApiConfig(env({ IAM_MFA_ENC_KEYS: undefined }))).toThrow(/IAM_MFA_ENC_KEYS/);
    expect(() => loadApiConfig(env({ IAM_HMAC_KEY: "c2hvcnQ" }))).toThrow(/at least 32 bytes/);
  });

  it("refuses plain HTTP in staging and production (DP_API_REQUIRE_TLS)", () => {
    for (const deployEnv of ["staging", "production"]) {
      expect(() => loadApiConfig(env({ DP_DEPLOY_ENV: deployEnv }))).toThrow(
        /DP_API_REQUIRE_TLS=true is mandatory/,
      );
      expect(() =>
        loadApiConfig(env({ DP_DEPLOY_ENV: deployEnv, DP_API_REQUIRE_TLS: "false" })),
      ).toThrow(/plain HTTP is refused/);
    }
    expect(() => loadApiConfig(env({ DP_DEPLOY_ENV: "test" }))).toThrow(/DP_DEPLOY_ENV/);
  });

  it("refuses the .env.example and test placeholders outside local development", () => {
    const placeholder = "change-me-prod-admin-proxy-key-local-000000";
    expect(() =>
      loadApiConfig(
        env({
          DP_DEPLOY_ENV: "staging",
          DP_API_REQUIRE_TLS: "true",
          DP_PROXY_KEY_ADMIN: placeholder,
        }),
      ),
    ).toThrow(/DP_PROXY_KEY_ADMIN holds a placeholder/);
    expect(loadApiConfig(env({ DP_PROXY_KEY_ADMIN: placeholder })).deployEnv).toBe("local");
  });

  it("with DP_API_REQUIRE_TLS=true, needs a readable PEM certificate and key", () => {
    const pem = {
      "/c.pem": Buffer.from("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"),
      "/k.pem": Buffer.from("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"),
    } as Record<string, Buffer>;
    const read = (p: string) => {
      const b = pem[p];
      if (!b) throw new Error("ENOENT");
      return b;
    };
    const tls = { DP_API_REQUIRE_TLS: "true" };
    expect(() => loadTlsConfig(tls, "production", read)).toThrow(/needs DP_API_TLS_CERT_FILE/);
    expect(() =>
      loadTlsConfig(
        { ...tls, DP_API_TLS_CERT_FILE: "/x", DP_API_TLS_KEY_FILE: "/k.pem" },
        "production",
        read,
      ),
    ).toThrow(/cannot be read/);
    expect(() =>
      loadTlsConfig(
        { ...tls, DP_API_TLS_CERT_FILE: "/k.pem", DP_API_TLS_KEY_FILE: "/k.pem" },
        "production",
        read,
      ),
    ).toThrow(/not a PEM certificate/);
    const ok = loadTlsConfig(
      { ...tls, DP_API_TLS_CERT_FILE: "/c.pem", DP_API_TLS_KEY_FILE: "/k.pem" },
      "production",
      read,
    );
    expect(ok?.cert).toBe(pem["/c.pem"]);
    expect(() => loadTlsConfig({ DP_API_REQUIRE_TLS: "yes" }, "local", read)).toThrow(
      ApiConfigError,
    );
  });

  it("accepts http origins only for local development hosts", () => {
    expect(parseOrigin("http://admin.localhost:3112", "V", "local")).toBe(
      "http://admin.localhost:3112",
    );
    expect(() => parseOrigin("http://admin.localhost:3112", "V", "production")).toThrow(/https/);
    expect(() => parseOrigin("http://evil.example", "V", "local")).toThrow(/https/);
    expect(() => parseOrigin("https://admin.dreampetroleum.com/path", "V", "local")).toThrow(
      /origin/,
    );
    expect(() =>
      loadApiConfig(env({ DP_ALLOWED_ORIGINS_ADMIN: "https://a.example,ftp://b" })),
    ).toThrow(/DP_ALLOWED_ORIGINS_ADMIN/);
  });
});

describe("CSRF (D4; NT-C1..3)", () => {
  const allowed = new Set(["https://admin.dreampetroleum.com"]);
  const json = "application/json";
  const cases: [string, Parameters<typeof csrfAllows>, boolean][] = [
    ["GET needs nothing", ["GET", undefined, undefined, undefined, allowed], true],
    [
      "allowed origin + JSON",
      ["POST", "https://admin.dreampetroleum.com", undefined, json, allowed],
      true,
    ],
    [
      "JSON with charset",
      ["POST", "https://admin.dreampetroleum.com", undefined, `${json}; charset=utf-8`, allowed],
      true,
    ],
    ["NT-C1 foreign origin", ["POST", "https://evil.example", undefined, json, allowed], false],
    [
      "NT-P8 a site origin on the admin key",
      ["POST", "https://dreampetroleumbv.com", undefined, json, allowed],
      false,
    ],
    ["NT-C2 no origin, cross-site", ["POST", undefined, "cross-site", json, allowed], false],
    ["no origin, no fetch metadata", ["POST", undefined, undefined, json, allowed], false],
    ["no origin, same-origin", ["POST", undefined, "same-origin", json, allowed], true],
    [
      "NT-C3 text/plain",
      ["POST", "https://admin.dreampetroleum.com", undefined, "text/plain", allowed],
      false,
    ],
    [
      "NT-C3 form",
      [
        "POST",
        "https://admin.dreampetroleum.com",
        undefined,
        "application/x-www-form-urlencoded",
        allowed,
      ],
      false,
    ],
    [
      "NT-C3 no content type",
      ["POST", "https://admin.dreampetroleum.com", undefined, undefined, allowed],
      false,
    ],
    [
      "DELETE with allowed origin",
      ["DELETE", "https://admin.dreampetroleum.com", undefined, undefined, allowed],
      true,
    ],
    ["DELETE cross-site", ["DELETE", undefined, "cross-site", undefined, allowed], false],
  ];
  for (const [name, args, expected] of cases) {
    it(name, () => expect(csrfAllows(...args)).toBe(expected));
  }

  it("serves only /health and /health/* without a key", () => {
    expect(isHealthPath("/health")).toBe(true);
    expect(isHealthPath("/health/ready")).toBe(true);
    expect(isHealthPath("/healthz")).toBe(false);
    expect(isHealthPath("/api/v1/health")).toBe(false);
  });
});

describe("cookies per app (NT-S6, NT-S7)", () => {
  const header =
    "__Host-dp_member_session=m; __Host-dp_admin_session=a; other=x; __Host-dp_admin_challenge=c";
  it("reads only the admin cookies on an admin request", () => {
    expect([...readCookies(header, APP_COOKIES.ADMIN)]).toEqual([
      ["__Host-dp_admin_session", "a"],
      ["__Host-dp_admin_challenge", "c"],
    ]);
  });
  it("reads only the member cookies on a site request", () => {
    expect([...readCookies(header, APP_COOKIES.WEB_BV)]).toEqual([
      ["__Host-dp_member_session", "m"],
    ]);
  });
});

describe("static guarantees", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? d.name === "generated"
          ? []
          : sources(path.join(dir, d.name))
        : d.name.endsWith(".ts")
          ? [path.join(dir, d.name)]
          : [],
    );
  }

  it("AC-PX-5: no source reads Host, X-Forwarded-*, Forwarded or X-Real-IP", () => {
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/["'`](host|x-forwarded-[a-z]+|forwarded|x-real-ip)["'`]/i);
      expect(text, file).not.toMatch(/\breq(uest)?\.(ip|ips|hostname|host|protocol|secure)\b/);
    }
  });

  it("NT-C4: GET handlers only read (session view and device list)", () => {
    const controller = readFileSync(path.join(SRC, "iam/staff/staff-auth.controller.ts"), "utf8");
    const gets = [...controller.matchAll(/@Get\("([^"]*)"\)\s+(\w+)\([^)]*\)[^{]*\{([^}]*)\}/g)];
    expect(gets.map((g) => g[1])).toEqual(["session", "sessions"]);
    for (const [, , , body] of gets) {
      expect(body?.trim()).toMatch(/^return this\.auth\.(session|listSessions)\(ctx\);$/);
    }
  });
});
