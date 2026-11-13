/**
 * Start-up configuration of the authentication boundary (F1-002 Group 2; ADR-013 D2, D19,
 * design 2.3, 2.7, 2.9). `loadApiConfig` throws on anything missing or weak, so the API does not
 * start (NT-L4, NT-P9, NT-P13). Error messages name variables, never values.
 *
 * | Variable                          | Meaning                                                     |
 * | --------------------------------- | ----------------------------------------------------------- |
 * | DP_PROXY_KEY_{ADMIN,WEB_BV,WEB_CORPORATE}[_NEXT] | per-app proxy keys (proxy-keys.ts)       |
 * | IAM_MFA_ENC_KEYS, IAM_HMAC_KEY    | TOTP encryption keyring, HMAC key (auth/secrets.ts)          |
 * | DP_DEPLOY_ENV                     | local (default) / staging / production                       |
 * | DP_API_REQUIRE_TLS                | true: serve HTTPS only; mandatory in staging and production |
 * | DP_API_TLS_CERT_FILE / _KEY_FILE  | PEM files for HTTPS (required with DP_API_REQUIRE_TLS=true)  |
 * | DP_ALLOWED_ORIGINS_{ADMIN,WEB_BV,WEB_CORPORATE} | comma-separated origins for CSRF (D4)      |
 * | DP_ADMIN_BASE_URL                 | origin of the admin app, for enrolment and reset links      |
 */
import { readFileSync } from "node:fs";
import { loadAuthSecrets, type AuthSecrets } from "../auth/secrets.js";
import { AUTH_APPS, parseProxyKeys, type AuthAppValue, type ProxyKeyring } from "./proxy-keys.js";

export class ApiConfigError extends Error {
  override name = "ApiConfigError";
}

export type DeployEnv = "local" | "staging" | "production";

export interface TlsConfig {
  cert: Buffer;
  key: Buffer;
}

export interface ApiConfig {
  deployEnv: DeployEnv;
  proxyKeys: ProxyKeyring;
  secrets: AuthSecrets;
  tls: TlsConfig | null;
  allowedOrigins: Readonly<Record<AuthAppValue, ReadonlySet<string>>>;
  adminBaseUrl: string;
}

export const DEFAULT_ORIGINS: Readonly<Record<AuthAppValue, readonly string[]>> = {
  ADMIN: ["https://admin.dreampetroleum.com"],
  WEB_BV: ["https://dreampetroleumbv.com", "https://www.dreampetroleumbv.com"],
  WEB_CORPORATE: ["https://dreampetroleum.com", "https://www.dreampetroleum.com"],
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/;

/** An exact origin (scheme://host[:port]); http only for local development hosts. */
export function parseOrigin(value: string, variable: string, deployEnv: DeployEnv): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiConfigError(`${variable}: "${value.trim()}" is not an origin`);
  }
  if (url.origin === "null" || `${url.origin}` !== value.trim().replace(/\/$/, "")) {
    throw new ApiConfigError(`${variable}: "${value.trim()}" is not an origin`);
  }
  if (url.protocol !== "https:") {
    const local = url.protocol === "http:" && LOCAL_HOST.test(url.hostname);
    if (!local || deployEnv !== "local") {
      throw new ApiConfigError(`${variable}: origins must use https outside local development`);
    }
  }
  return url.origin;
}

function deployEnvOf(env: NodeJS.ProcessEnv): DeployEnv {
  const raw = (env["DP_DEPLOY_ENV"] ?? "local").trim() || "local";
  if (raw !== "local" && raw !== "staging" && raw !== "production") {
    throw new ApiConfigError("DP_DEPLOY_ENV must be local, staging or production");
  }
  return raw;
}

/**
 * TLS between proxy and API (Ö2, design 2.7). Staging and production must set
 * DP_API_REQUIRE_TLS=true; with it the API serves HTTPS with the given certificate and refuses to
 * start without one, so it can never listen in plain HTTP there (AC-PX-8, NT-P13).
 */
export function loadTlsConfig(
  env: NodeJS.ProcessEnv,
  deployEnv: DeployEnv,
  readFile: (path: string) => Buffer = (p) => readFileSync(p),
): TlsConfig | null {
  const raw = (env["DP_API_REQUIRE_TLS"] ?? "").trim().toLowerCase();
  if (raw !== "" && raw !== "true" && raw !== "false") {
    throw new ApiConfigError("DP_API_REQUIRE_TLS must be true or false");
  }
  const require = raw === "true";
  if (!require) {
    if (deployEnv !== "local") {
      throw new ApiConfigError(
        `DP_API_REQUIRE_TLS=true is mandatory when DP_DEPLOY_ENV=${deployEnv}; plain HTTP is refused`,
      );
    }
    return null;
  }
  const certPath = env["DP_API_TLS_CERT_FILE"]?.trim();
  const keyPath = env["DP_API_TLS_KEY_FILE"]?.trim();
  if (!certPath || !keyPath) {
    throw new ApiConfigError(
      "DP_API_REQUIRE_TLS=true needs DP_API_TLS_CERT_FILE and DP_API_TLS_KEY_FILE; plain HTTP is refused",
    );
  }
  let cert: Buffer;
  let key: Buffer;
  try {
    cert = readFile(certPath);
    key = readFile(keyPath);
  } catch {
    throw new ApiConfigError("DP_API_TLS_CERT_FILE or DP_API_TLS_KEY_FILE cannot be read");
  }
  if (!/-----BEGIN [A-Z ]*CERTIFICATE-----/.test(cert.toString("utf8"))) {
    throw new ApiConfigError("DP_API_TLS_CERT_FILE is not a PEM certificate");
  }
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key.toString("utf8"))) {
    throw new ApiConfigError("DP_API_TLS_KEY_FILE is not a PEM private key");
  }
  return { cert, key };
}

/** Values from .env.example or the test stacks; refused outside local development. */
const PLACEHOLDER = /change-me|test-only|not-a-secret/i;
const SECRET_VARIABLES = [
  "DP_PROXY_KEY_ADMIN",
  "DP_PROXY_KEY_WEB_BV",
  "DP_PROXY_KEY_WEB_CORPORATE",
  "DP_PROXY_KEY_ADMIN_NEXT",
  "DP_PROXY_KEY_WEB_BV_NEXT",
  "DP_PROXY_KEY_WEB_CORPORATE_NEXT",
  "IAM_MFA_ENC_KEYS",
  "IAM_HMAC_KEY",
];

export function loadApiConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile?: (path: string) => Buffer,
): ApiConfig {
  const deployEnv = deployEnvOf(env);
  if (deployEnv !== "local") {
    for (const name of SECRET_VARIABLES) {
      if (PLACEHOLDER.test(env[name] ?? "")) {
        throw new ApiConfigError(`${name} holds a placeholder value; use a vault secret (A7)`);
      }
    }
  }
  const proxyKeys = parseProxyKeys(env);
  const secrets = loadAuthSecrets(env);
  const tls = loadTlsConfig(env, deployEnv, readFile);

  const allowedOrigins = {} as Record<AuthAppValue, ReadonlySet<string>>;
  for (const app of AUTH_APPS) {
    const variable = `DP_ALLOWED_ORIGINS_${app}`;
    const raw = env[variable]?.trim();
    const list = raw ? raw.split(",").filter((s) => s.trim() !== "") : DEFAULT_ORIGINS[app];
    allowedOrigins[app] = new Set(list.map((o) => parseOrigin(o, variable, deployEnv)));
  }

  const adminBaseUrl = parseOrigin(
    env["DP_ADMIN_BASE_URL"]?.trim() || (DEFAULT_ORIGINS.ADMIN[0] as string),
    "DP_ADMIN_BASE_URL",
    deployEnv,
  );
  return { deployEnv, proxyKeys, secrets, tls, allowedOrigins, adminBaseUrl };
}

/** Nest injection token of the validated configuration. */
export const API_CONFIG = "DP_API_CONFIG";
