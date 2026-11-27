"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  LEAD_COMPANY_MAX,
  LEAD_FULL_NAME_MAX,
  LEAD_MESSAGE_MAX,
  LEAD_MESSAGE_MIN,
  LEAD_PHONE_MAX,
  LEAD_SUBJECT_MAX,
  LEAD_SUBJECT_MIN,
  LEAD_TEXT_OUTDATED,
} from "@dream/contracts";

import type { ContactFormLabels } from "@/lib/i18n";
import { CONTACT_FORM_PATH } from "@/lib/contact-form";

/**
 * COM-4 (DP-030): the corporate contact form — web-bv's form (DP-151, DP-221) in the corporate
 * design. Posts to this site (`/lead-form/contact`), which forwards it to the platform API with
 * this site's key; the message is stored on the sender's CORPORATE lead and read by the sales
 * team under Leads (lead:read).
 *
 * The fields are the API's contract (LeadContactMessageInputSchema): name, e-mail, company,
 * country, subject and message are required, the phone is optional. No marketing consent and no
 * box to tick (owner decisions 2026-11-13): the contact notice is information shown before the
 * button with a link to the Privacy Policy, and the form sends the version it showed.
 *
 * Answers: the thank-you panel only on 201 (stored as a lead); otherwise a message for what
 * happened (fields to check, too many messages with the wait, not available, no connection,
 * the notice changed since the page was loaded).
 */
interface Props {
  idPrefix: string;
  title: string;
  countries: { code: string; name: string }[];
  notice: { version: string; text: string };
  privacyHref: string | null;
  locale: string;
  ui: ContactFormLabels;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string; fields: string[] }
  | { kind: "outdated" };

const FIELDS = ["fullName", "email", "company", "country", "phone", "subject", "message"] as const;

function messageFor(
  ui: ContactFormLabels,
  status: number,
  code: string,
  retryAfter: string | null,
) {
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfter ?? "60") / 60));
    return (minutes === 1 ? ui.tooManyOne : ui.tooManyOther).replace("{count}", String(minutes));
  }
  if (status === 400 && code === "VALIDATION_FAILED") return ui.checkFields;
  if (status === 404) return ui.unavailable;
  return ui.failed;
}

export function ContactForm({
  idPrefix,
  title,
  countries,
  notice,
  privacyHref,
  locale,
  ui,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const id = (name: string) => `${idPrefix}-${name}`;
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status.kind !== "done" || !doneRef.current) return;
    doneRef.current.scrollIntoView({ block: "center" });
    doneRef.current.focus({ preventScroll: true });
  }, [status.kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "");
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(CONTACT_FORM_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: value("fullName"),
          company: value("company"),
          email: value("email"),
          country: value("country"),
          phone: value("phone"),
          subject: value("subject"),
          message: value("message"),
          privacyNoticeVersion: notice.version,
          // ML-10: the language of the notice shown (the API refuses another language's version).
          locale,
          website: value("website"),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        code?: string;
        fields?: string[];
      } | null;
      if (res.status === 201) {
        setStatus({ kind: "done" });
        return;
      }
      if (res.status === 409 && body?.code === LEAD_TEXT_OUTDATED) {
        setStatus({ kind: "outdated" });
        return;
      }
      setStatus({
        kind: "error",
        message: messageFor(ui, res.status, body?.code ?? "", res.headers.get("retry-after")),
        // The honeypot is never named to a person: it is not a field they can see.
        fields: (body?.fields ?? []).filter((f) => (FIELDS as readonly string[]).includes(f)),
      });
    } catch {
      setStatus({ kind: "error", message: ui.noConnection, fields: [] });
    }
  }

  if (status.kind === "done") {
    return (
      <div className="form-panel contact-done" aria-live="polite" ref={doneRef} tabIndex={-1}>
        <h3>{ui.thankYou}</h3>
        <p role="status">{ui.received}</p>
      </div>
    );
  }

  const invalid = (name: string) => status.kind === "error" && status.fields.includes(name);
  const sending = status.kind === "sending";
  const errorId = id("error");
  const label = (text: string, required: boolean) => (
    <span className="field-label">
      {text}
      {required ? (
        <span aria-hidden="true"> *</span>
      ) : (
        <span className="field-optional"> {ui.optional}</span>
      )}
    </span>
  );
  return (
    <div className="form-panel">
      <h3>{title}</h3>
      <p className="form-required-note">{ui.requiredNote}</p>
      <form
        className="contact-form"
        onSubmit={onSubmit}
        aria-describedby={status.kind === "error" ? errorId : undefined}
      >
        <fieldset disabled={sending}>
          <legend className="sr-only">{title}</legend>
          <label className="field">
            {label(ui.name, true)}
            <input
              name="fullName"
              required
              minLength={2}
              maxLength={LEAD_FULL_NAME_MAX}
              autoComplete="name"
              aria-invalid={invalid("fullName")}
            />
          </label>
          <label className="field">
            {label(ui.email, true)}
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              aria-invalid={invalid("email")}
            />
          </label>
          <label className="field">
            {label(ui.company, true)}
            <input
              name="company"
              required
              maxLength={LEAD_COMPANY_MAX}
              autoComplete="organization"
              aria-invalid={invalid("company")}
            />
          </label>
          <label className="field">
            {label(ui.country, true)}
            <select name="country" required defaultValue="" aria-invalid={invalid("country")}>
              <option value="" disabled>
                {ui.select}
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {label(ui.phone, false)}
            <input
              name="phone"
              type="tel"
              maxLength={LEAD_PHONE_MAX}
              autoComplete="tel"
              aria-invalid={invalid("phone")}
            />
          </label>
          <label className="field">
            {label(ui.subject, true)}
            <input
              name="subject"
              required
              minLength={LEAD_SUBJECT_MIN}
              maxLength={LEAD_SUBJECT_MAX}
              autoComplete="off"
              aria-invalid={invalid("subject")}
            />
          </label>
          <label className="field field-wide">
            {label(ui.message, true)}
            <textarea
              name="message"
              required
              minLength={LEAD_MESSAGE_MIN}
              maxLength={LEAD_MESSAGE_MAX}
              rows={6}
              aria-invalid={invalid("message")}
            />
          </label>

          {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
          <div aria-hidden="true" className="honeypot">
            <label>
              {ui.website}
              <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>

          {status.kind === "outdated" ? (
            <p role="alert" className="form-alert field-wide">
              {ui.outdated}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => window.location.reload()}
              >
                {ui.reload}
              </button>
            </p>
          ) : null}

          {status.kind === "error" ? (
            <p id={errorId} role="alert" className="form-alert form-alert-error field-wide">
              {status.message}
              {status.fields.length ? (
                <span className="form-alert-fields">
                  {status.fields
                    .map(
                      (f) =>
                        ({
                          fullName: ui.name,
                          email: ui.email,
                          company: ui.company,
                          country: ui.country,
                          phone: ui.phone,
                          subject: ui.subject,
                          message: ui.message,
                        })[f as (typeof FIELDS)[number]] ?? f,
                    )
                    .join(", ")}
                </span>
              ) : null}
            </p>
          ) : null}

          <section className="form-notice field-wide" aria-labelledby={id("notice")}>
            <h4 id={id("notice")}>{ui.noticeTitle}</h4>
            <p>{notice.text}</p>
            <p className="form-notice-meta">
              {privacyHref ? (
                <a href={privacyHref} target="_blank" rel="noopener">
                  {ui.readPrivacyPolicy}
                  <span className="sr-only"> {ui.newTab}</span>
                </a>
              ) : null}{" "}
              <span>{ui.noticeVersion.replace("{version}", notice.version)}</span>
            </p>
          </section>

          <button type="submit" className="btn btn-primary field-wide contact-submit">
            {sending ? ui.sending : ui.send}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
