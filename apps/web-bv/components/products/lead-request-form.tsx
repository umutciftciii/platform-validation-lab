"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  LEAD_TEXT_OUTDATED,
  LeadFormTextsSchema,
  type LeadFormTexts,
  type SiteLeadRequestResult,
} from "@dream/contracts";

/**
 * DP-042 (ADR-016): the short form for a lead-gated document. The required privacy notice and the
 * optional marketing consent are separate; the marketing box is never pre-ticked. The download
 * grant stays in an HttpOnly cookie set by this site's server; this component only learns the
 * reference and the download URL.
 *
 * DP-095 D-T7: when the texts changed after the page was loaded, the API refuses the old version
 * and this site answers LEAD_TEXT_OUTDATED. The form then loads the current texts, unticks both
 * boxes (an earlier tick is never reused for a new text) and asks the visitor to read and confirm
 * again; the other fields keep what was typed.
 */
interface Props {
  documentId: string;
  documentTitle: string;
  countries: { code: string; name: string }[];
  texts: LeadFormTexts;
  privacyHref: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; result: SiteLeadRequestResult }
  | { kind: "error"; message: string; fields: string[] }
  /** The texts were replaced by newer ones (updated) or could not be (reload). */
  | { kind: "outdated"; updated: boolean };

const FIELD_LABEL: Record<string, string> = {
  fullName: "Full name",
  company: "Company",
  email: "Work e-mail",
  country: "Country",
  privacyNoticeAccepted: "Privacy notice",
};

const INPUT =
  "mt-1.5 block w-full rounded-xl border border-glass/15 bg-ink/60 px-3.5 py-2.5 text-base text-glass placeholder:text-steel/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 aria-[invalid=true]:border-red-400";

function messageFor(status: number, code: string, retryAfter: string | null): string {
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfter ?? "60") / 60));
    return `Too many requests. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (status === 404) return "This document is no longer available on request.";
  if (status === 400 && code === "VALIDATION_FAILED") return "Please check the highlighted fields.";
  return "Something went wrong. Please try again in a moment.";
}

/** The current texts from this site's server, or null when they cannot be read. */
async function fetchCurrentTexts(): Promise<LeadFormTexts | null> {
  try {
    const res = await fetch("/lead-form/texts", { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = LeadFormTextsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function LeadRequestForm({ documentId, documentTitle, countries, texts: initialTexts, privacyHref }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [texts, setTexts] = useState(initialTexts);
  // Remounting the consent boxes unticks them when the texts change.
  const [consentRound, setConsentRound] = useState(0);
  const consentRef = useRef<HTMLFieldSetElement>(null);
  const { privacyNotice, marketingConsent } = texts;

  async function refreshTexts() {
    const current = await fetchCurrentTexts();
    const changed =
      current !== null &&
      (current.privacyNotice.version !== privacyNotice.version ||
        current.marketingConsent.version !== marketingConsent.version);
    if (changed) {
      setTexts(current);
      setConsentRound((n) => n + 1);
    }
    setStatus({ kind: "outdated", updated: changed });
    if (changed) requestAnimationFrame(() => consentRef.current?.scrollIntoView({ block: "center" }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const marketing = data.get("marketingConsent") === "on";
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`/product-documents/${documentId}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: String(data.get("fullName") ?? ""),
          company: String(data.get("company") ?? ""),
          email: String(data.get("email") ?? ""),
          country: String(data.get("country") ?? ""),
          privacyNoticeVersion: privacyNotice.version,
          privacyNoticeAccepted: data.get("privacyNoticeAccepted") === "on",
          marketingConsent: marketing,
          marketingConsentVersion: marketing ? marketingConsent.version : null,
          website: String(data.get("website") ?? ""),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | (SiteLeadRequestResult & { code?: string; fields?: string[] })
        | null;
      if (res.status === 409 && body?.code === LEAD_TEXT_OUTDATED) {
        await refreshTexts();
        return;
      }
      if (res.status === 201 && body?.downloadUrl) {
        setStatus({ kind: "done", result: body });
        window.location.assign(body.downloadUrl);
        return;
      }
      setStatus({
        kind: "error",
        message: messageFor(res.status, body?.code ?? "", res.headers.get("retry-after")),
        fields: body?.fields ?? [],
      });
    } catch {
      setStatus({ kind: "error", message: "No connection. Please try again.", fields: [] });
    }
  }

  if (status.kind === "done") {
    const until = new Date(status.result.expiresAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border border-amber/30 bg-amber/[0.06] p-6 sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">Thank you</p>
        <h2 className="mt-2 text-2xl font-medium text-glass">Your download has started</h2>
        <p className="mt-3 text-steel">
          {documentTitle}. Request reference{" "}
          <span className="font-mono text-glass">{status.result.reference}</span>.
        </p>
        <p className="mt-3 text-sm text-steel">
          If it did not start, use the button below. It works until {until}, up to{" "}
          {status.result.maxDownloads} downloads in total.
        </p>
        <a
          href={status.result.downloadUrl}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-amber/90"
        >
          Download PDF
        </a>
      </section>
    );
  }

  const invalid = (name: string) => status.kind === "error" && status.fields.includes(name);
  const sending = status.kind === "sending";
  return (
    <form
      onSubmit={onSubmit}
      noValidate={false}
      className="rounded-2xl border border-glass/10 bg-glass/[0.03] p-5 sm:p-8"
      aria-describedby={status.kind === "error" ? "lead-form-error" : undefined}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block text-sm text-steel">
          Full name
          <input name="fullName" required minLength={2} maxLength={120} autoComplete="name" className={INPUT} aria-invalid={invalid("fullName")} />
        </label>
        <label className="block text-sm text-steel">
          Company
          <input name="company" required maxLength={160} autoComplete="organization" className={INPUT} aria-invalid={invalid("company")} />
        </label>
        <label className="block text-sm text-steel">
          Work e-mail
          <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" className={INPUT} aria-invalid={invalid("email")} />
        </label>
        <label className="block text-sm text-steel">
          Country
          <select name="country" required defaultValue="" className={INPUT} aria-invalid={invalid("country")}>
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
      </div>

      {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <fieldset key={consentRound} ref={consentRef} className="mt-6 space-y-4">
        <legend className="sr-only">Privacy</legend>
        <label className="flex gap-3 text-sm leading-relaxed text-steel">
          <input
            type="checkbox"
            name="privacyNoticeAccepted"
            required
            className="mt-1 size-4 shrink-0 accent-amber"
            aria-invalid={invalid("privacyNoticeAccepted")}
          />
          <span>
            <span className="text-glass">I have read how my details are used (required).</span> {privacyNotice.text}{" "}
            <a
              href={privacyHref}
              target="_blank"
              rel="noopener"
              className="text-glass underline decoration-glass/30 underline-offset-4 hover:decoration-amber"
            >
              Read the Privacy Policy
            </a>
          </span>
        </label>
        <label className="flex gap-3 text-sm leading-relaxed text-steel">
          <input type="checkbox" name="marketingConsent" className="mt-1 size-4 shrink-0 accent-amber" />
          <span>
            {marketingConsent.text} <span className="text-steel/70">(optional)</span>
          </span>
        </label>
      </fieldset>

      {status.kind === "outdated" ? (
        <div role="alert" className="mt-6 rounded-xl border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-glass">
          {status.updated ? (
            <>
              Our privacy information was updated after you opened this page. Please read the current text above and
              tick the box again. Your other details are kept.
            </>
          ) : (
            <>
              Our privacy information was updated after you opened this page.{" "}
              <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-4">
                Reload the page
              </button>{" "}
              to see the current version.
            </>
          )}
        </div>
      ) : null}

      {status.kind === "error" ? (
        <div id="lead-form-error" role="alert" className="mt-6 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-glass">
          {status.message}
          {status.fields.length ? (
            <span className="block text-steel">
              {status.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-steel/80">
          Notice version {privacyNotice.version} · consent version {marketingConsent.version}
        </p>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-amber/90 disabled:opacity-60 sm:w-auto"
        >
          {sending ? "Sending…" : "Request and download"}
        </button>
      </div>
    </form>
  );
}
