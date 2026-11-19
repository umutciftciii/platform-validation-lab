"use client";
/**
 * Contact-form notification settings of one site (DP-221, ADR-026 D3): switch the staff e-mail on
 * or off and choose who gets it. Shown to staff with lead:manage on the site; the API and the
 * database decide every change again (recipients must read the site's leads).
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import {
  LEAD_NOTIFICATION_RECIPIENTS_MAX,
  type LeadNotificationSaveResponse,
  type LeadNotificationSiteSettings,
} from "@dream/contracts";
import { postJson } from "../../lib/staff-client";
import { FormMessage } from "../catalog/parts";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

type Message = { kind: "error" | "success"; text: string } | null;

export function NotificationSettingsForm({ settings }: { settings: LeadNotificationSiteSettings }) {
  const router = useRouter();
  const id = useId();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [chosen, setChosen] = useState<string[]>(settings.recipients.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // After a save the page reloads the settings: take the stored state, keep the confirmation
  // (adjusting state while rendering, as React recommends instead of an effect).
  const [seenVersion, setSeenVersion] = useState(settings.version);
  if (seenVersion !== settings.version) {
    setSeenVersion(settings.version);
    setEnabled(settings.enabled);
    setChosen(settings.recipients.map((r) => r.id));
  }

  // People on the list who lost lead access stay visible until someone removes them.
  const lost = settings.recipients.filter((r) => !r.eligible);
  const people = [
    ...settings.candidates.map((c) => ({ ...c, eligible: true })),
    ...lost.filter((r) => !settings.candidates.some((c) => c.id === r.id)),
  ];
  const dirty =
    enabled !== settings.enabled ||
    chosen.length !== settings.recipients.length ||
    chosen.some((c) => !settings.recipients.some((r) => r.id === c));
  const full = chosen.length >= LEAD_NOTIFICATION_RECIPIENTS_MAX;

  function toggle(personId: string, on: boolean) {
    setChosen((list) => (on ? [...list, personId] : list.filter((x) => x !== personId)));
    setMessage(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (enabled && chosen.length === 0) {
      setMessage({ kind: "error", text: "Choose at least one person, or switch the e-mail off." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await postJson<LeadNotificationSaveResponse>(
      `/api/v1/admin/lead-notifications/sites/${encodeURIComponent(settings.site.id)}`,
      { version: settings.version, enabled, recipientUserIds: chosen },
    );
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    setMessage({ kind: "success", text: "Saved. New messages follow these settings." });
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5"
      aria-label={`Notifications for ${settings.site.name}`}
    >
      <label
        htmlFor={`${id}-on`}
        className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
      >
        <input
          id={`${id}-on`}
          type="checkbox"
          className="mt-1 size-4 accent-petrol"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setMessage(null);
          }}
        />
        <span>
          <span className="block font-medium text-ink">
            E-mail staff about new contact-form messages
          </span>
          <span className="block text-sm text-ink-3">
            The e-mail says only that a message arrived and links to the lead here. Names, e-mail
            addresses and the message stay in the CRM.
          </span>
        </span>
      </label>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-1 text-sm font-medium text-ink">
          Who gets the e-mail{" "}
          <span className="font-normal text-ink-3">
            ({chosen.length} of at most {LEAD_NOTIFICATION_RECIPIENTS_MAX})
          </span>
        </legend>
        {people.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nobody can read this site&apos;s leads yet. Give someone a lead role under Staff and
            access first.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {people.map((p) => {
              const on = chosen.includes(p.id);
              return (
                <li key={p.id}>
                  <label
                    htmlFor={`${id}-${p.id}`}
                    className={cx(
                      "flex items-center gap-3 px-4 py-2.5",
                      p.eligible || on ? "cursor-pointer" : "opacity-60",
                    )}
                  >
                    <input
                      id={`${id}-${p.id}`}
                      type="checkbox"
                      className="size-4 shrink-0 accent-petrol"
                      checked={on}
                      // Someone who lost lead access can be removed, never added.
                      disabled={(!on && (!p.eligible || full)) || busy}
                      onChange={(e) => toggle(p.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {p.displayName}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{p.email}</span>
                    </span>
                    {p.eligible ? null : <StatusPill tone="amber">No lead access</StatusPill>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-ink-3">
          Only staff who can read this site&apos;s leads are listed. If someone loses that access,
          they stop getting the e-mail at once.
        </p>
      </fieldset>

      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonStyles.primary} disabled={!dirty || busy}>
          {busy ? <Spinner /> : null}
          <span>Save</span>
        </button>
        {dirty && !busy ? (
          <button
            type="button"
            className={buttonStyles.secondary}
            onClick={() => {
              setEnabled(settings.enabled);
              setChosen(settings.recipients.map((r) => r.id));
              setMessage(null);
            }}
          >
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
