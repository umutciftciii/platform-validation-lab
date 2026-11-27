/**
 * COM-6: the cookie choice of a visitor of dreampetroleum.com and Google Analytics 4 behind it.
 *
 *  - Two kinds of cookies: necessary (the site works and remembers this choice: `dp_consent`
 *    itself; always on) and analytics (GA4: `_ga`, `_ga_<id>`; only after the visitor accepts).
 *  - The choice is a first-party cookie (`dp_consent=v1.a1.<seconds>` granted, `v1.a0.…`
 *    refused), kept 180 days; an unknown version or a broken value counts as no choice yet, so
 *    the banner asks again. Nothing is sent to the server: the site reads it in the browser.
 *  - GA4 is configured per environment (`DP_GA4_MEASUREMENT_ID_CORPORATE`, never in code). Without
 *    a valid id there is nothing to consent to: no banner, no script, the site works as before.
 *  - Before consent the GA4 script is never requested. On consent it is loaded once, with ad
 *    features off (Consent Mode: ad_storage, ad_user_data, ad_personalization denied). When the
 *    visitor withdraws, the official opt-out flag (`window['ga-disable-<id>']`) stops every
 *    further hit at once, Consent Mode is updated to denied and the `_ga` cookies are removed.
 *
 * Pure (no React, no Next.js, no `@/` imports): the browser objects come in as `ConsentEnv`, so
 * `node --test` runs it with fakes.
 */

export const CONSENT_COOKIE = "dp_consent";
export const CONSENT_VERSION = "v1";
/** 180 days, in seconds. */
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60;
export const GA4_SCRIPT_ORIGIN = "https://www.googletagmanager.com";
/** The event the footer's "Cookie settings" button sends to reopen the choice. */
export const CONSENT_OPEN_EVENT = "dp:cookie-settings";

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;

export interface ConsentChoice {
  analytics: boolean;
  /** When the visitor chose (seconds since 1970). */
  decidedAt: number;
}

/** The GA4 measurement id of this environment, or null (unset, empty or not a GA4 id). */
export function measurementIdOf(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const id = env["DP_GA4_MEASUREMENT_ID_CORPORATE"]?.trim().toUpperCase() ?? "";
  return MEASUREMENT_ID.test(id) ? id : null;
}

/** The visitor's choice from `document.cookie`, or null when there is none (ask). */
export function readConsent(cookieHeader: string | null | undefined): ConsentChoice | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== CONSENT_COOKIE) continue;
    const m = /^v1\.a([01])\.(\d{1,12})$/.exec(part.slice(eq + 1).trim());
    if (!m) return null;
    return { analytics: m[1] === "1", decidedAt: Number(m[2]) };
  }
  return null;
}

/** The `document.cookie` assignment that stores a choice. */
export function consentCookie(choice: ConsentChoice, secure: boolean): string {
  const value = `${CONSENT_VERSION}.a${choice.analytics ? 1 : 0}.${Math.floor(choice.decidedAt)}`;
  return `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The names of the GA4 cookies present (`_ga`, `_ga_<container>`, older `_gid`, `_gat…`). */
export function analyticsCookieNames(cookieHeader: string | null | undefined): string[] {
  const names = new Set<string>();
  for (const part of (cookieHeader ?? "").split(";")) {
    const name = part.split("=")[0]?.trim() ?? "";
    if (/^(?:_ga|_ga_[A-Za-z0-9]+|_gid|_gat(?:_[A-Za-z0-9_-]+)?)$/.test(name)) names.add(name);
  }
  return [...names];
}

/**
 * The assignments that remove a cookie wherever GA4 may have set it: the host itself and every
 * parent domain (GA4 writes to the highest one it can, `.dreampetroleum.com`).
 */
export function expireCookie(name: string, hostname: string): string[] {
  const base = `${name}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  const out = [base];
  const labels = hostname.split(".");
  if (labels.length < 2 || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return out;
  for (let i = 0; i <= labels.length - 2; i++)
    out.push(`${base}; Domain=.${labels.slice(i).join(".")}`);
  return out;
}

/** The browser objects the consent runtime uses (real ones in the page, fakes in tests). */
export interface ConsentEnv {
  /** Reads and writes `document.cookie`. */
  readCookies(): string;
  writeCookie(assignment: string): void;
  hostname: string;
  secure: boolean;
  /** `window` (dataLayer, gtag, the opt-out flag). */
  win: Record<string, unknown>;
  /** Appends `<script async src>` to the document. */
  addScript(src: string): void;
  /** Whether the GA4 script was already added to this page. */
  hasScript(src: string): boolean;
}

export function ga4ScriptUrl(id: string): string {
  return `${GA4_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
}

type Gtag = (...args: unknown[]) => void;

function gtagOf(env: ConsentEnv): Gtag {
  const w = env.win;
  if (!Array.isArray(w["dataLayer"])) w["dataLayer"] = [];
  if (typeof w["gtag"] !== "function") {
    // The documented gtag stub: it pushes its `arguments` object onto the data layer.
    w["gtag"] = function gtag() {
      // eslint-disable-next-line prefer-rest-params -- gtag.js reads Arguments objects
      (w["dataLayer"] as unknown[]).push(arguments);
    };
  }
  return w["gtag"] as Gtag;
}

/** What `applyConsent` did (tests and the component's own state). */
export type AnalyticsState = "off" | "loaded" | "resumed" | "stopped";

/**
 * Applies a choice to the page: GA4 loaded (or resumed) when analytics is granted and an id is
 * configured; stopped and its cookies removed otherwise. Never adds the script without consent.
 */
export function applyConsent(
  env: ConsentEnv,
  measurementId: string | null,
  choice: ConsentChoice | null,
): AnalyticsState {
  if (!measurementId) return "off";
  const flag = `ga-disable-${measurementId}`;
  const src = ga4ScriptUrl(measurementId);
  if (choice?.analytics) {
    env.win[flag] = false;
    const gtag = gtagOf(env);
    if (env.hasScript(src)) {
      gtag("consent", "update", { analytics_storage: "granted" });
      return "resumed";
    }
    gtag("consent", "default", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    gtag("js", new Date());
    gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    env.addScript(src);
    return "loaded";
  }
  // Refused or withdrawn: no further hit from this page, no GA4 cookie left behind.
  const loaded = env.hasScript(src);
  env.win[flag] = true;
  if (loaded) gtagOf(env)("consent", "update", { analytics_storage: "denied" });
  for (const name of analyticsCookieNames(env.readCookies())) {
    for (const a of expireCookie(name, env.hostname)) env.writeCookie(a);
  }
  return loaded ? "stopped" : "off";
}

/** Stores the visitor's choice and applies it. */
export function decide(
  env: ConsentEnv,
  measurementId: string | null,
  analytics: boolean,
  now: number = Date.now(),
): AnalyticsState {
  const choice = { analytics, decidedAt: Math.floor(now / 1000) };
  env.writeCookie(consentCookie(choice, env.secure));
  return applyConsent(env, measurementId, choice);
}
