/**
 * Session and login security policies, separate for staff and customers (F1-001, F1-002;
 * ADR-013, which takes over the policy table of ADR-011 section 8). Defined in code so that no
 * admin setting, God Mode included, can weaken them. Login, session and throttle code reads its
 * limits from here.
 *
 * F1-002 (owner decisions A5, A9, Ö4): there is no hard account lockout. Failed logins push the
 * next allowed attempt out exponentially (`throttle`, AuthThrottle buckets). The old
 * `maxFailedLogins`/`lockoutMinutes` fields are gone from code; the `User.failedLoginCount` and
 * `User.lockedUntil` columns stay in the database, unused (ADR-013 D6).
 */
import type { UserKindValue } from "./catalog.js";

export type AppName = "admin" | "web-bv" | "web-corporate";

export interface ThrottlePolicy {
  /** Failures per account (any IP) before the delay starts. */
  accountFree: number;
  /** Ceiling of the account-wide delay. Short on purpose: no lasting lockout (T2). */
  accountMaxDelaySec: number;
  /** Failures per account and IP prefix before the delay starts. */
  accountIpFree: number;
  /** Ceiling of the account+IP delay. */
  accountIpMaxDelaySec: number;
}

export interface SessionPolicy {
  /** Host-only cookie (`__Host-` prefix: Secure, Path=/, no Domain), never shared between apps. */
  cookieName: string;
  /** Short-lived cookie between the password and the MFA step. */
  challengeCookieName: string;
  /** Apps where this kind of user may hold a session. */
  apps: readonly AppName[];
  mfa: "required" | "optional";
  /** A sensitive permission needs an MFA verification no older than this (staff only). */
  stepUpMaxAgeMinutes: number | null;
  idleTimeoutMinutes: number;
  absoluteTimeoutMinutes: number;
  /** "Remember me" style persistent sessions. */
  persistent: boolean;
  /** Opening one more session revokes the oldest (LIMIT_EXCEEDED). */
  maxConcurrentSessions: number;
  /** Minimum password length (A5). Staff always have MFA, so both values are 12. */
  minPasswordLength: { withMfa: number; withoutMfa: number };
  throttle: ThrottlePolicy;
  /** Rotate the session id on login, privilege change and step-up. */
  rotateOnPrivilegeChange: true;
}

export const MAX_PASSWORD_LENGTH = 128;

/** Per-IP bucket, shared by both user kinds (design 3.2). */
export const IP_THROTTLE = {
  /** Failures allowed per window before the IP is blocked. */
  free: 30,
  windowMinutes: 10,
  blockMinutes: 10,
} as const;

/** Account-wide failure counts that raise `iam.login_attack_suspected` (design 3.2). */
export const ATTACK_SUSPECTED_THRESHOLDS: readonly number[] = [10, 50];

/** Buckets without a failure for this long start over (design 3.2, 8.6). */
export const THROTTLE_RESET_HOURS = 24;

export const SESSION_POLICIES: Readonly<Record<UserKindValue, SessionPolicy>> = {
  STAFF: {
    cookieName: "__Host-dp_admin_session",
    challengeCookieName: "__Host-dp_admin_challenge",
    apps: ["admin"],
    mfa: "required",
    stepUpMaxAgeMinutes: 10,
    idleTimeoutMinutes: 30,
    absoluteTimeoutMinutes: 8 * 60,
    persistent: false,
    maxConcurrentSessions: 5,
    minPasswordLength: { withMfa: 12, withoutMfa: 12 },
    throttle: {
      accountFree: 5,
      accountMaxDelaySec: 60,
      accountIpFree: 3,
      accountIpMaxDelaySec: 15 * 60,
    },
    rotateOnPrivilegeChange: true,
  },
  CUSTOMER: {
    cookieName: "__Host-dp_member_session",
    challengeCookieName: "__Host-dp_member_challenge",
    apps: ["web-bv", "web-corporate"],
    mfa: "optional",
    stepUpMaxAgeMinutes: null,
    idleTimeoutMinutes: 7 * 24 * 60,
    absoluteTimeoutMinutes: 30 * 24 * 60,
    persistent: true,
    maxConcurrentSessions: 10,
    minPasswordLength: { withMfa: 12, withoutMfa: 15 },
    throttle: {
      accountFree: 5,
      accountMaxDelaySec: 30,
      accountIpFree: 3,
      accountIpMaxDelaySec: 15 * 60,
    },
    rotateOnPrivilegeChange: true,
  },
};

export function sessionPolicyFor(kind: UserKindValue): SessionPolicy {
  return SESSION_POLICIES[kind];
}

/** A staff account never gets a public-site session and a customer never an admin session. */
export function mayOpenSession(kind: UserKindValue, app: AppName): boolean {
  return SESSION_POLICIES[kind].apps.includes(app);
}

/** Minimum password length for a user of this kind, with or without MFA (A5). */
export function minPasswordLength(kind: UserKindValue, hasMfa: boolean): number {
  const { withMfa, withoutMfa } = SESSION_POLICIES[kind].minPasswordLength;
  return hasMfa ? withMfa : withoutMfa;
}
