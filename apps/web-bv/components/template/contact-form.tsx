"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { LEAD_MESSAGE_MAX, LEAD_TEXT_OUTDATED } from "@dream/contracts";

/**
 * DP-151: the contact form. Posts to this site's server (`/lead-form/contact`), which forwards it
 * to the platform API with the site's key; the message is stored on the sender's lead and read by
 * the sales team in the admin console (lead:read).
 *
 * Owner decisions (2026-11-13): no marketing consent box, and no tick box for the privacy notice.
 * Answering an enquiry rests on legitimate interest, so the notice is information shown next to
 * the button with a link to the Privacy Policy; the form sends the version it showed.
 *
 * When the notice changed after the page was loaded (LEAD_TEXT_OUTDATED), the visitor is asked to
 * reload the page, read the current text and send again.
 */
interface Props {
  idPrefix: string;
  title: string;
  countries: { code: string; name: string }[];
  notice: { version: string; text: string };
  privacyHref: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string; fields: string[] }
  | { kind: "outdated" };

const FIELD_LABEL: Record<string, string> = {
  fullName: "Your name",
  company: "Company",
  email: "Your e-mail",
  country: "Country",
  phone: "Phone number",
  subject: "Subject",
  message: "Your message",
};

function messageFor(status: number, code: string, retryAfter: string | null): string {
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfter ?? "60") / 60));
    return `Too many messages. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (status === 400 && code === "VALIDATION_FAILED") return "Please check the highlighted fields.";
  if (status === 404) return "The contact form is not available right now. Please call or e-mail us.";
  return "Something went wrong. Please try again in a moment, or call or e-mail us.";
}

export function ContactForm({ idPrefix, title, countries, notice, privacyHref }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const id = (name: string) => `${idPrefix}-${name}`;
  // The thank-you panel is much shorter than the form: bring it into view and move focus to it,
  // so the visitor (and a screen reader) lands on the confirmation, not in the footer.
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status.kind !== "done" || !doneRef.current) return;
    doneRef.current.scrollIntoView({ block: "center" });
    doneRef.current.focus({ preventScroll: true });
  }, [status.kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/lead-form/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: String(data.get("fullName") ?? ""),
          company: String(data.get("company") ?? ""),
          email: String(data.get("email") ?? ""),
          country: String(data.get("country") ?? ""),
          phone: String(data.get("phone") ?? ""),
          subject: String(data.get("subject") ?? ""),
          message: String(data.get("message") ?? ""),
          privacyNoticeVersion: notice.version,
          website: String(data.get("website") ?? ""),
        }),
      });
      const body = (await res.json().catch(() => null)) as { code?: string; fields?: string[] } | null;
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
        message: messageFor(res.status, body?.code ?? "", res.headers.get("retry-after")),
        // The honeypot is never named to a person: it is not a field they can see.
        fields: (body?.fields ?? []).filter((f) => f !== "website"),
      });
    } catch {
      setStatus({ kind: "error", message: "No connection. Please try again.", fields: [] });
    }
  }

  if (status.kind === "done") {
    return (
      <div className="tp-contact-form" aria-live="polite" ref={doneRef} tabIndex={-1}>
        <h3 className="tp-contact-form-title">Thank you</h3>
        <p className="tp-contact-form-note" role="status">
          We have received your message and will reply by e-mail.
        </p>
      </div>
    );
  }

  const invalid = (name: string) => status.kind === "error" && status.fields.includes(name);
  const sending = status.kind === "sending";
  const errorId = id("error");
  return (
    <div className="tp-contact-form">
      <h3 className="tp-contact-form-title">{title}</h3>
      <form
        className="tp-contact-fields"
        onSubmit={onSubmit}
        aria-describedby={status.kind === "error" ? errorId : undefined}
      >
        <fieldset className="tp-contact-fieldset" disabled={sending}>
          <legend className="sr-only">{title}</legend>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">
              Your name<span aria-hidden="true"> *</span>
            </span>
            <input
              name="fullName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              className="tp-contact-input"
              aria-invalid={invalid("fullName")}
            />
          </label>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">
              Your e-mail<span aria-hidden="true"> *</span>
            </span>
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              className="tp-contact-input"
              aria-invalid={invalid("email")}
            />
          </label>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">
              Company<span aria-hidden="true"> *</span>
            </span>
            <input
              name="company"
              required
              maxLength={160}
              autoComplete="organization"
              className="tp-contact-input"
              aria-invalid={invalid("company")}
            />
          </label>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">
              Country<span aria-hidden="true"> *</span>
            </span>
            <select
              name="country"
              required
              defaultValue=""
              className="tp-contact-input"
              aria-invalid={invalid("country")}
            >
              <option value="" disabled>
                Select…
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">Phone number</span>
            <input
              name="phone"
              type="tel"
              maxLength={40}
              autoComplete="tel"
              className="tp-contact-input"
              aria-invalid={invalid("phone")}
            />
          </label>
          <label className="tp-contact-field">
            <span className="tp-contact-field-label">Subject</span>
            <input
              name="subject"
              maxLength={160}
              autoComplete="off"
              className="tp-contact-input"
              aria-invalid={invalid("subject")}
            />
          </label>
          <label className="tp-contact-field tp-contact-field-wide">
            <span className="tp-contact-field-label">
              Your message<span aria-hidden="true"> *</span>
            </span>
            <textarea
              name="message"
              required
              minLength={10}
              maxLength={LEAD_MESSAGE_MAX}
              rows={6}
              className="tp-contact-input"
              aria-invalid={invalid("message")}
            />
          </label>

          {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
          <div aria-hidden="true" className="tp-contact-honeypot">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>

          {status.kind === "outdated" ? (
            <p role="alert" className="tp-contact-alert tp-contact-field-wide">
              Our privacy information was updated after you opened this page.{" "}
              <button type="button" onClick={() => window.location.reload()} className="tp-contact-inline-link">
                Reload the page
              </button>{" "}
              to read the current version, then send your message again.
            </p>
          ) : null}

          {status.kind === "error" ? (
            <p id={errorId} role="alert" className="tp-contact-alert tp-contact-alert-error tp-contact-field-wide">
              {status.message}
              {status.fields.length ? (
                <span className="tp-contact-alert-fields">
                  {status.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}
                </span>
              ) : null}
            </p>
          ) : null}

          <section className="tp-contact-notice tp-contact-field-wide" aria-labelledby={id("notice")}>
            <h4 id={id("notice")} className="tp-contact-notice-title">
              How we use your details
            </h4>
            <p>{notice.text}</p>
            <p>
              <a href={privacyHref} target="_blank" rel="noopener" className="tp-contact-inline-link">
                Read the Privacy Policy
              </a>{" "}
              <span className="tp-contact-version">· notice version {notice.version}</span>
            </p>
          </section>

          <button type="submit" className="tp-button tp-contact-submit">
            {sending ? "Sending…" : "Send message"}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
