// Generated per test run: proxy keys and IAM secrets the API needs to start (F1-002 Group 2).
// Never fixed values, so nothing here can be mistaken for a real secret.
import { randomBytes } from "node:crypto";

const k = () => randomBytes(32).toString("base64url");

export const TEST_KEYS = {
  admin: k(),
  adminNext: k(),
  webBv: k(),
  webCorporate: k(),
  mfa: k(),
  hmac: k(),
};

export const ADMIN_ORIGIN = "http://admin.localhost:3112";

/** Environment for an API under test (no _NEXT key; rotation tests add it). */
export function apiTestEnv(): Record<string, string> {
  return {
    DP_PROXY_KEY_ADMIN: TEST_KEYS.admin,
    DP_PROXY_KEY_WEB_BV: TEST_KEYS.webBv,
    DP_PROXY_KEY_WEB_CORPORATE: TEST_KEYS.webCorporate,
    IAM_MFA_ENC_KEYS: `1:${TEST_KEYS.mfa}`,
    IAM_HMAC_KEY: TEST_KEYS.hmac,
    DP_ALLOWED_ORIGINS_ADMIN: ADMIN_ORIGIN,
    DP_ADMIN_BASE_URL: ADMIN_ORIGIN,
    IAM_CLEANUP_INTERVAL_MINUTES: "0",
    LEAD_RETENTION_REPORT_INTERVAL_MINUTES: "0",
  };
}
