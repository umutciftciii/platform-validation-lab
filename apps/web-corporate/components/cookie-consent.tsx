"use client";

/**
 * COM-6: the cookie choice of the corporate site (rules: lib/consent.ts). Shown only where GA4 is
 * configured (otherwise the site sets no optional cookie and asks nothing).
 *
 *  - A bar at the end of the page, sticky at the bottom of the screen until the visitor decides:
 *    it never covers the footer for good (at the end of the page it sits below it) and stays one
 *    short paragraph and three equal buttons on a phone. Not a modal: the page stays usable.
 *  - Accept analytics / Reject analytics / Preferences (necessary always on, analytics on or off,
 *    Save). The choice is kept 180 days; "Cookie settings" in the footer opens it again.
 *  - GA4 is requested only after "Accept"; withdrawing stops it at once (lib/consent.ts).
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  CONSENT_OPEN_EVENT,
  applyConsent,
  consentCookie,
  readConsent,
  type ConsentEnv,
} from "@/lib/consent";
import type { CookieLabels } from "@/lib/i18n";

/** Sent after the choice cookie was written, so every reader of the store renders again. */
const CONSENT_CHANGED_EVENT = "dp:cookie-choice";

function browserEnv(): ConsentEnv {
  return {
    readCookies: () => document.cookie,
    writeCookie: (a) => {
      document.cookie = a;
    },
    hostname: window.location.hostname,
    secure: window.location.protocol === "https:",
    win: window as unknown as Record<string, unknown>,
    addScript: (src) => {
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.dataset["dpAnalytics"] = "ga4";
      document.head.appendChild(s);
    },
    hasScript: (src) =>
      Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-dp-analytics]")).some(
        (s) => s.src === src,
      ),
  };
}

/** The stored choice as a stable value: "unknown" on the server (the page may be cached). */
type Status = "unknown" | "none" | "granted" | "refused";
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
}
function currentStatus(): Status {
  const c = readConsent(document.cookie);
  return c === null ? "none" : c.analytics ? "granted" : "refused";
}
const serverStatus = (): Status => "unknown";

export function CookieConsent({
  measurementId,
  labels,
  privacyHref,
}: {
  measurementId: string;
  labels: CookieLabels;
  /** The Privacy Policy where it is published (DP-095), else no link. */
  privacyHref: string | null;
}) {
  const status = useSyncExternalStore(subscribe, currentStatus, serverStatus);
  /** Opened again from "Cookie settings" after a choice. */
  const [reopened, setReopened] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const toggleId = useId();

  // The page follows the stored choice: GA4 only once granted, stopped as soon as withdrawn.
  useEffect(() => {
    if (status === "unknown") return;
    applyConsent(
      browserEnv(),
      measurementId,
      status === "none" ? null : { analytics: status === "granted", decidedAt: 0 },
    );
  }, [status, measurementId]);

  // "Cookie settings" in the footer.
  useEffect(() => {
    const open = () => {
      setAnalytics(status === "granted");
      setSaved(false);
      setPreferences(true);
      setReopened(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, [status]);

  const visible = status === "none" || reopened;
  useEffect(() => {
    if (visible && (preferences || reopened)) heading.current?.focus();
  }, [visible, preferences, reopened]);

  const choose = useCallback((value: boolean) => {
    const env = browserEnv();
    env.writeCookie(consentCookie({ analytics: value, decidedAt: Date.now() / 1000 }, env.secure));
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
    setAnalytics(value);
    setReopened(false);
    setPreferences(false);
    setSaved(true);
  }, []);

  if (status === "unknown") return null;
  if (!visible) {
    return saved ? (
      <p className="sr-only" role="status">
        {labels.saved}
      </p>
    ) : null;
  }
  return (
    <section className="cookie-bar" role="region" aria-labelledby={titleId}>
      <div className="container-site cookie-inner">
        <div className="cookie-text">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="cookie-title">
            {preferences ? labels.preferencesTitle : labels.title}
          </h2>
          <p>
            {labels.text}{" "}
            {privacyHref ? (
              <a href={privacyHref} className="cookie-link">
                {labels.privacy}
              </a>
            ) : null}
          </p>
        </div>
        {preferences ? (
          <form
            className="cookie-preferences"
            onSubmit={(e) => {
              e.preventDefault();
              choose(analytics);
            }}
          >
            <div className="cookie-option">
              <div>
                <p className="cookie-option-title">{labels.necessaryTitle}</p>
                <p className="cookie-option-text">{labels.necessaryText}</p>
              </div>
              <span className="cookie-always">{labels.alwaysOn}</span>
            </div>
            <div className="cookie-option">
              <div>
                <label htmlFor={toggleId} className="cookie-option-title">
                  {labels.analyticsTitle}
                </label>
                <p className="cookie-option-text">{labels.analyticsText}</p>
              </div>
              <input
                id={toggleId}
                type="checkbox"
                role="switch"
                className="cookie-switch"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
            </div>
            <div className="cookie-actions">
              <button type="submit" className="btn btn-primary cookie-btn">
                {labels.save}
              </button>
              <button
                type="button"
                className="btn cookie-btn cookie-btn-outline"
                onClick={() => choose(false)}
              >
                {labels.reject}
              </button>
            </div>
          </form>
        ) : (
          <div className="cookie-actions">
            <button
              type="button"
              className="btn btn-primary cookie-btn"
              onClick={() => choose(true)}
            >
              {labels.accept}
            </button>
            <button
              type="button"
              className="btn btn-primary cookie-btn"
              onClick={() => choose(false)}
            >
              {labels.reject}
            </button>
            <button
              type="button"
              className="btn cookie-btn cookie-btn-outline"
              onClick={() => {
                setAnalytics(false);
                setPreferences(true);
              }}
            >
              {labels.preferences}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The footer's "Cookie settings": reopens the choice (CookieConsent listens). */
export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="cookie-settings-link"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      {label}
    </button>
  );
}
