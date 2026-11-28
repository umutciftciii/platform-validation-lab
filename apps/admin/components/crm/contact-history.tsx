/**
 * CRM-3 (ADR-032 D11): a contact history — contact-form messages and the contacts staff logged on
 * the leads (DP-041: e-mail, phone, meeting) — newest first. Built so CRM-4 can add e-mail as
 * another entry kind without changing the view. Rendered on the server.
 */
import Link from "next/link";
import type { CrmContactEntry } from "@dream/contracts";
import type { Translate } from "../../lib/i18n/types";
import { channelLabel } from "../../lib/leads-view";
import { StatusPill } from "../ui";

function channel(entry: CrmContactEntry, t: Translate): string {
  return entry.channel === "CONTACT_FORM"
    ? t("crm.contacts.contactForm")
    : channelLabel(entry.channel, t);
}

export function ContactHistory({
  items,
  t,
  date,
  showPerson,
}: {
  items: readonly CrmContactEntry[];
  t: Translate;
  date: Intl.DateTimeFormat;
  showPerson: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4">
        <p className="text-sm font-medium text-ink">{t("crm.contacts.empty")}</p>
        <p className="mt-1 text-sm text-ink-3">{t("crm.contacts.emptyText")}</p>
      </div>
    );
  }
  return (
    <ol className="space-y-4">
      {items.map((c) => (
        <li key={`${c.kind}-${c.id}`} className="border-l-2 border-line pl-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={c.kind === "FORM_MESSAGE" ? "petrol" : "neutral"}>
              {channel(c, t)}
            </StatusPill>
            <span className="text-sm text-ink">
              {c.kind === "FORM_MESSAGE"
                ? t("crm.contacts.received", {
                    lead: c.lead.label ?? t("crm.history.unnamedLead"),
                  })
                : t("crm.contacts.logged", {
                    name: c.actor?.displayName ?? t("crm.common.formerStaff"),
                    lead: c.lead.label ?? t("crm.history.unnamedLead"),
                  })}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            <time dateTime={c.at}>{date.format(new Date(c.at))}</time>
            {showPerson && c.person ? (
              <span key="person">
                {" · "}
                <Link
                  href={`/crm/people/${c.person.id}`}
                  className="text-petrol-strong underline-offset-2 hover:underline"
                >
                  {c.person.displayName ?? t("crm.people.anonymisedPerson")}
                </Link>
              </span>
            ) : null}
            {c.lead.label ? (
              <span key="lead">
                {" · "}
                <Link
                  href={`/leads/${c.lead.id}`}
                  className="text-petrol-strong underline-offset-2 hover:underline"
                >
                  {t("crm.contacts.openLead")}
                </Link>
              </span>
            ) : null}
          </p>
          {c.subject ? (
            <p className="mt-2 break-words text-sm font-medium text-ink">{c.subject}</p>
          ) : null}
          {c.body ? (
            <p className="mt-1 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
              {c.body}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-3">{t("crm.contacts.noText")}</p>
          )}
          {c.phone ? (
            <p className="mt-1 text-xs text-ink-3">{t("crm.contacts.phone", { phone: c.phone })}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
