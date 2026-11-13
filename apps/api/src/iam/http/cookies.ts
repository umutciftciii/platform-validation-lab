/**
 * Cookie handling (design 5.1, 2.4). The API reads only the cookie names of the app derived from
 * the proxy key (admin: `__Host-dp_admin_session`, `__Host-dp_admin_challenge`), so a member
 * cookie is never looked at on an admin request and the other way round (NT-S6, NT-S7).
 * Admin cookies: `__Host-` prefix, Secure, HttpOnly, Path=/, no Domain, SameSite=Strict, and no
 * Max-Age for the session (browser session); the challenge lives five minutes.
 */
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  MEMBER_CHALLENGE_COOKIE,
  MEMBER_SESSION_COOKIE,
} from "@dream/contracts";
import type { AuthAppValue } from "./proxy-keys.js";

export const APP_COOKIES: Readonly<Record<AuthAppValue, readonly string[]>> = {
  ADMIN: [ADMIN_SESSION_COOKIE, ADMIN_CHALLENGE_COOKIE],
  WEB_BV: [MEMBER_SESSION_COOKIE, MEMBER_CHALLENGE_COOKIE],
  WEB_CORPORATE: [MEMBER_SESSION_COOKIE, MEMBER_CHALLENGE_COOKIE],
};

/** Parses a Cookie header and keeps only the allowed names (first occurrence wins). */
export function readCookies(
  header: string | undefined,
  allowed: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!allowed.includes(name) || out.has(name)) continue;
    out.set(name, part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(value: string): string {
  return `${ADMIN_SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export const CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

export function challengeCookie(value: string): string {
  return `${ADMIN_CHALLENGE_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${CHALLENGE_MAX_AGE_SECONDS}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
