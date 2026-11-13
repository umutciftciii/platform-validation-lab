/**
 * Single-use credential links in the browser (DP-114): `/enrol#t=…` (activation, invitation,
 * operator recovery including the system owner's, MFA re-enrolment) and `/reset#t=…` (password
 * reset with the second factor).
 *
 * - The token lives only in the URL fragment, which no server and no Referer header ever sees.
 *   The page reads it once, keeps it in this tab's sessionStorage and takes it out of the address
 *   bar at once (history.replaceState: no new history entry, so Back never brings it back).
 * - A reload continues the flow with the stored token; after the last step only a "done" marker
 *   stays, so a reload shows "completed, sign in" instead of a misleading "invalid link". A link
 *   the API refused is remembered the same way.
 * - Passwords, codes, the TOTP secret and recovery codes are never stored, logged or put in a URL.
 * - A new link (a fragment with a token) always replaces what this tab remembered.
 */
import {
  DEFAULT_ERROR_MESSAGES,
  ErrorBodySchema,
  type EnrolInspectResponse,
  type EnrolKind,
  type EnrolMfaConfirmResponse,
  type EnrolMfaSetupResponse,
  type ErrorCode,
} from "@dream/contracts";

export type LinkPage = "enrol" | "reset";

const STORE_KEY: Readonly<Record<LinkPage, string>> = {
  enrol: "dp-admin-enrol-link",
  reset: "dp-admin-reset-link",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FRAGMENT_TOKEN = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/;

/** What this tab knows about its link. */
export type LinkState =
  | { status: "token"; token: string }
  | { status: "done"; kind: EnrolKind | "reset" }
  | { status: "invalid" }
  | { status: "none" };

/** The token of a fragment (`#t=…`), or null. */
export function tokenFromFragment(hash: string): string | null {
  return FRAGMENT_TOKEN.exec(hash)?.[1] ?? null;
}

/** Whether the address still carries a token (or any `t=` attempt) that must be removed. */
export function fragmentNeedsCleaning(hash: string): boolean {
  return /(?:^#|&)t=/.test(hash);
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function read(store: KeyValueStore | null, page: LinkPage): LinkState {
  if (!store) return { status: "none" };
  let raw: string | null = null;
  try {
    raw = store.getItem(STORE_KEY[page]);
  } catch {
    return { status: "none" };
  }
  if (!raw) return { status: "none" };
  try {
    const value = JSON.parse(raw) as { t?: unknown; done?: unknown; invalid?: unknown };
    if (typeof value.t === "string" && TOKEN.test(value.t)) {
      return { status: "token", token: value.t };
    }
    if (
      typeof value.done === "string" &&
      ["activation", "invitation", "recovery", "mfa_reenrolment", "reset"].includes(value.done)
    ) {
      return { status: "done", kind: value.done as EnrolKind | "reset" };
    }
    if (value.invalid === true) return { status: "invalid" };
  } catch {
    // Unreadable entry: treated as nothing remembered.
  }
  return { status: "none" };
}

function write(store: KeyValueStore | null, page: LinkPage, value: object | null): void {
  if (!store) return;
  try {
    if (value === null) store.removeItem(STORE_KEY[page]);
    else store.setItem(STORE_KEY[page], JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the flow still works until the page is reloaded.
  }
}

/**
 * Resolves the link of this page load: a token in the fragment wins and is remembered; without
 * one, what this tab remembered from an earlier load. The caller removes the fragment.
 */
export function claimLink(hash: string, store: KeyValueStore | null, page: LinkPage): LinkState {
  const fromLink = tokenFromFragment(hash);
  if (fromLink) {
    write(store, page, { t: fromLink });
    return { status: "token", token: fromLink };
  }
  return read(store, page);
}

export function rememberDone(
  store: KeyValueStore | null,
  page: LinkPage,
  kind: EnrolKind | "reset",
): void {
  write(store, page, { done: kind });
}

export function rememberInvalid(store: KeyValueStore | null, page: LinkPage): void {
  write(store, page, { invalid: true });
}

export function forgetLink(store: KeyValueStore | null, page: LinkPage): void {
  write(store, page, null);
}

/** sessionStorage, or null where the browser refuses it. */
export function tabStore(): KeyValueStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Resolves the link now and again whenever a new link arrives in this tab without a page load
 * (a link pasted into a tab already on the page only changes the fragment, so the page does not
 * reload). Each time, the fragment is replaced away: neither the address bar nor that history
 * entry keeps the token. `onState` runs in a microtask, outside React's render and effect body.
 */
export function followLink(page: LinkPage, onState: (state: LinkState) => void): () => void {
  const resolve = () => {
    const { hash, pathname, search } = window.location;
    const state = claimLink(hash, tabStore(), page);
    // Take the token out of the address bar before anything else can read or share it.
    if (fragmentNeedsCleaning(hash)) window.history.replaceState(null, "", pathname + search);
    void Promise.resolve().then(() => onState(state));
  };
  const onHashChange = () => {
    if (fragmentNeedsCleaning(window.location.hash)) resolve();
  };
  resolve();
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}

// --- API calls (through the admin's same-origin proxy) ---------------------------------------

const ENROL_API = "/api/v1/auth/staff/enrol";
const RESET_API = "/api/v1/auth/staff/password/reset";

/** Why a call failed, as far as the page has to react differently. */
export type FailureKind =
  | "link" // the link is spent, expired, replaced or blocked: the flow ends
  | "policy" // the new password breaks a rule (details name the rules)
  | "credentials" // wrong current password (MFA re-enrolment)
  | "code" // wrong authenticator or recovery code
  | "state" // a step is out of order or the authenticator setup expired: start the step again
  | "rate" // too many attempts
  | "network"
  | "other";

export type LinkCall<T> =
  { ok: true; data: T } | { ok: false; failure: FailureKind; message: string; details: string[] };

export const POLICY_MESSAGES: Readonly<Record<string, string>> = {
  too_short: "Use at least 12 characters.",
  too_long: "Use at most 128 characters.",
  breached: "This password appears in known data breaches. Choose a different one.",
  contains_identity: "Do not use your name or parts of your e-mail address.",
  requires_change: "Choose a password you have not used here before.",
};

const LINK_MESSAGE =
  "This link can no longer be used. It may have expired, been used already, or been replaced by a newer link. Ask a platform administrator for a new one.";

const FAILURE_BY_CODE: Partial<Record<ErrorCode, FailureKind>> = {
  AUTH_TOKEN_INVALID: "link",
  VALIDATION_FAILED: "other",
  AUTH_PASSWORD_POLICY: "policy",
  AUTH_INVALID_CREDENTIALS: "credentials",
  AUTH_MFA_INVALID: "code",
  CONFLICT_STATE: "state",
};

export function failureMessage(failure: FailureKind, code: ErrorCode | null): string {
  switch (failure) {
    case "link":
      return LINK_MESSAGE;
    case "policy":
      return "Choose a stronger password.";
    case "credentials":
      return "That is not your current password. Repeated mistakes end this link.";
    case "code":
      return "That code is not correct. Repeated mistakes end this link.";
    case "state":
      return "This step has to start again. Follow the instructions below.";
    case "rate":
      return "Too many attempts. Wait a few minutes before trying again.";
    case "network":
      return "The admin service could not be reached. Check your connection and try again.";
    default:
      return code ? DEFAULT_ERROR_MESSAGES[code] : "Something went wrong. Try again in a moment.";
  }
}

/** Maps an API answer to a result; never reads or returns what was sent. */
export async function toLinkCall<T>(res: Response): Promise<LinkCall<T>> {
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  if (res.status === 429) {
    return { ok: false, failure: "rate", message: failureMessage("rate", null), details: [] };
  }
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const details = parsed.success
    ? parsed.data.error.details.map((d) => (typeof d === "string" ? d : d.rule))
    : [];
  // The page only ever sends well-formed tokens (claimLink), so validation errors are about input.
  const failure: FailureKind = (code && FAILURE_BY_CODE[code]) ?? "other";
  return { ok: false, failure, message: failureMessage(failure, code), details };
}

async function post<T>(url: string, body: unknown): Promise<LinkCall<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, failure: "network", message: failureMessage("network", null), details: [] };
  }
  return toLinkCall<T>(res);
}

export const inspectLink = (token: string) =>
  post<EnrolInspectResponse>(`${ENROL_API}/inspect`, { token });

export const setNewPassword = (token: string, password: string) =>
  post<void>(`${ENROL_API}/password`, { token, password });

export const proveCurrentPassword = (token: string, currentPassword: string) =>
  post<void>(`${ENROL_API}/password`, { token, currentPassword });

export const startAuthenticator = (token: string) =>
  post<EnrolMfaSetupResponse>(`${ENROL_API}/mfa/setup`, { token });

export const confirmAuthenticator = (token: string, code: string) =>
  post<EnrolMfaConfirmResponse>(`${ENROL_API}/mfa/confirm`, { token, code });

export const resetPassword = (
  token: string,
  newPassword: string,
  second: { code: string } | { recoveryCode: string },
) => post<void>(RESET_API, { token, newPassword, ...second });

// --- presentation helpers --------------------------------------------------------------------

/** The manual-entry key in groups of four, as authenticator apps show it. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/** Recovery codes as a small text file the person keeps offline. */
export function recoveryCodesText(codes: readonly string[], emailMasked: string): string {
  return [
    "Dream Petroleum admin console: recovery codes",
    `Account: ${emailMasked}`,
    "",
    "Each code works once, for sign-in when your authenticator is not at hand.",
    "Keep this file offline and out of shared folders.",
    "",
    ...codes,
    "",
  ].join("\n");
}

export const KIND_COPY: Readonly<
  Record<EnrolKind, { eyebrow: string; title: string; intro: string }>
> = {
  activation: {
    eyebrow: "Account activation",
    title: "Activate your account",
    intro: "Set a password and connect your authenticator app to finish setting up your account.",
  },
  invitation: {
    eyebrow: "Invitation",
    title: "Accept your invitation",
    intro:
      "You were invited to the Dream Petroleum admin console. Set a password and connect your authenticator app.",
  },
  recovery: {
    eyebrow: "Account recovery",
    title: "Recover your account",
    intro:
      "Your previous password, authenticator and recovery codes were cleared by the operator. Set new ones to sign in again.",
  },
  mfa_reenrolment: {
    eyebrow: "Authenticator reset",
    title: "Set up your authenticator again",
    intro:
      "An administrator reset your authenticator. Confirm your current password, then connect your authenticator app again.",
  },
};
