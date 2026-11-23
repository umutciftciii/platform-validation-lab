"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  LEAD_TEXT_OUTDATED,
  LeadFormTextsSchema,
  type LeadFormTexts,
  type SiteLeadRequestResult,
} from "@dream/contracts";

import { Rich } from "@/components/i18n/rich";
import type { LeadFormUi } from "@/lib/i18n";
import { formatTime, plural } from "@/lib/i18n/format";

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
 *
 * ML-10: the texts are those of the page's language (`locale`), the form sends that language,
 * and newer texts are read for that language only.
 */
interface Props {
  documentId: string;
  documentTitle: string;
  /** ML-9: the `lang` of the title when the document's language is not the page's. */
  documentLang?: string;
  countries: { code: string; name: string }[];
  texts: LeadFormTexts;
  privacyHref: string;
  /** ML-6: the page's language (plural rules, time format) and the form's words in it. */
  locale: string;
  ui: LeadFormUi;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; result: SiteLeadRequestResult }
  | { kind: "error"; message: string; fields: string[] }
  /** The texts were replaced by newer ones (updated) or could not be (reload). */
  | { kind: "outdated"; updated: boolean };

/** The form's field names as the visitor reads them (named in a validation message). */
function fieldLabels(ui: LeadFormUi): Record<string, string> {
  return {
    fullName: ui.fullName,
    company: ui.company,
    email: ui.email,
    country: ui.country,
    privacyNoticeAccepted: ui.privacyNotice,
  };
}

const INPUT =
  "mt-1.5 block w-full rounded-xl border border-glass/15 bg-ink/60 px-3.5 py-2.5 text-base text-glass placeholder:text-steel/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 aria-[invalid=true]:border-red-400";

function messageFor(
  ui: LeadFormUi,
  locale: string,
  status: number,
  code: string,
  retryAfter: string | null,
): string {
  if (status === 429) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfter ?? "60") / 60));
    return plural(locale, ui.tooMany, minutes);
  }
  if (status === 404) return ui.documentGone;
  if (status === 400 && code === "VALIDATION_FAILED") return ui.checkFields;
  return ui.failed;
}

/** The current texts of the form's language from this site's server, or null when unreadable. */
async function fetchCurrentTexts(locale: string): Promise<LeadFormTexts | null> {
  try {
    const res = await fetch(`/lead-form/texts?locale=${encodeURIComponent(locale)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const parsed = LeadFormTextsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function LeadRequestForm({
  documentId,
  documentTitle,
  documentLang,
  countries,
  texts: initialTexts,
  privacyHref,
  locale,
  ui,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [texts, setTexts] = useState(initialTexts);
  // Remounting the consent boxes unticks them when the texts change.
  const [consentRound, setConsentRound] = useState(0);
  const consentRef = useRef<HTMLFieldSetElement>(null);
  const { privacyNotice, marketingConsent } = texts;

  async function refreshTexts() {
    const current = await fetchCurrentTexts(locale);
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
          // ML-10: the language of the texts shown (the API refuses another language's versions).
          locale,
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
        message: messageFor(ui, locale, res.status, body?.code ?? "", res.headers.get("retry-after")),
        fields: body?.fields ?? [],
      });
    } catch {
      setStatus({ kind: "error", message: ui.noConnection, fields: [] });
    }
  }

  if (status.kind === "done") {
    // The visitor's own clock (unchanged since DP-042): the time is read on their device.
    const until = formatTime(locale, status.result.expiresAt, null);
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border border-amber/30 bg-amber/[0.06] p-6 sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">{ui.doneEyebrow}</p>
        <h2 className="mt-2 text-2xl font-medium text-glass">{ui.doneTitle}</h2>
        <p className="mt-3 text-steel">
          <Rich
            text={ui.doneReference}
            values={{
              title: documentLang ? <span lang={documentLang}>{documentTitle}</span> : documentTitle,
              reference: <span className="font-mono text-glass">{status.result.reference}</span>,
            }}
          />
        </p>
        <p className="mt-3 text-sm text-steel">
          <Rich text={ui.doneFallback} values={{ time: until, max: status.result.maxDownloads }} />
        </p>
        <a
          href={status.result.downloadUrl}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-amber/90"
        >
          {ui.downloadPdf}
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
          {ui.fullName}
          <input name="fullName" required minLength={2} maxLength={120} autoComplete="name" className={INPUT} aria-invalid={invalid("fullName")} />
        </label>
        <label className="block text-sm text-steel">
          {ui.company}
          <input name="company" required maxLength={160} autoComplete="organization" className={INPUT} aria-invalid={invalid("company")} />
        </label>
        <label className="block text-sm text-steel">
          {ui.email}
          <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" className={INPUT} aria-invalid={invalid("email")} />
        </label>
        <label className="block text-sm text-steel">
          {ui.country}
          <select name="country" required defaultValue="" className={INPUT} aria-invalid={invalid("country")}>
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
      </div>

      {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          {ui.website}
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <fieldset key={consentRound} ref={consentRef} className="mt-6 space-y-4">
        <legend className="sr-only">{ui.privacyLegend}</legend>
        <label className="flex gap-3 text-sm leading-relaxed text-steel">
          <input
            type="checkbox"
            name="privacyNoticeAccepted"
            required
            className="mt-1 size-4 shrink-0 accent-amber"
            aria-invalid={invalid("privacyNoticeAccepted")}
          />
          <span>
            <span className="text-glass">{ui.privacyAccept}</span> {privacyNotice.text}{" "}
            <a
              href={privacyHref}
              target="_blank"
              rel="noopener"
              className="text-glass underline decoration-glass/30 underline-offset-4 hover:decoration-amber"
            >
              {ui.readPrivacyPolicy}
            </a>
          </span>
        </label>
        <label className="flex gap-3 text-sm leading-relaxed text-steel">
          <input type="checkbox" name="marketingConsent" className="mt-1 size-4 shrink-0 accent-amber" />
          <span>
            {marketingConsent.text} <span className="text-steel/70">{ui.optional}</span>
          </span>
        </label>
      </fieldset>

      {status.kind === "outdated" ? (
        <div role="alert" className="mt-6 rounded-xl border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-glass">
          {status.updated ? (
            ui.outdatedUpdated
          ) : (
            <Rich
              text={ui.outdatedReload}
              values={{
                reload: (
                  <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-4">
                    {ui.reload}
                  </button>
                ),
              }}
            />
          )}
        </div>
      ) : null}

      {status.kind === "error" ? (
        <div id="lead-form-error" role="alert" className="mt-6 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-glass">
          {status.message}
          {status.fields.length ? (
            <span className="block text-steel">
              {status.fields.map((f) => fieldLabels(ui)[f] ?? f).join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-steel/80">
          <Rich text={ui.versions} values={{ notice: privacyNotice.version, consent: marketingConsent.version }} />
        </p>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-amber/90 disabled:opacity-60 sm:w-auto"
        >
          {sending ? ui.sending : ui.submit}
        </button>
      </div>
    </form>
  );
}
