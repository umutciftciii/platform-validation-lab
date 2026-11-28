/**
 * CRM-3 (ADR-032 D11): leads with their requests — the document requests and contact-form
 * messages each lead sent — as the company's "Leads and requests" tab and a person's profile show
 * them. Rendered on the server (dates formatted there). Anonymised leads keep their place without
 * their identity. The full record (consent evidence, downloads, messages) stays on the lead page.
 */
import Link from "next/link";
import type { CrmLeadRecord } from "@dream/contracts";
import type { Translate } from "../../lib/i18n/types";
import { sourceLabel, STATUS_TONE, statusLabel } from "../../lib/leads-view";
import { StatusPill } from "../ui";

export function LeadRecords({
  leads,
  t,
  date,
  showPerson,
}: {
  leads: readonly CrmLeadRecord[];
  t: Translate;
  date: Intl.DateTimeFormat;
  /** Name each lead's person (a company's leads); a person's profile leaves it out. */
  showPerson: boolean;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4">
        <p className="text-sm font-medium text-ink">{t("crm.leads.empty")}</p>
        <p className="mt-1 text-sm text-ink-3">{t("crm.leads.emptyText")}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-4">
      {leads.map((l) => {
        const requests = [
          ...l.documentRequests.map((r) => ({
            id: r.id,
            at: r.createdAt,
            kind: "document" as const,
            text: [r.product.code, r.product.name].filter(Boolean).join(" · "),
            detail: r.document.title,
          })),
          ...l.contactMessages.map((m) => ({
            id: m.id,
            at: m.createdAt,
            kind: "message" as const,
            text: m.subject ?? t("crm.leads.noSubject"),
            detail: null,
          })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        return (
          <li key={l.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {l.anonymised ? (
                  <p key="anon" className="text-sm font-medium text-ink-3">
                    {t("crm.people.anonymisedLead")}
                  </p>
                ) : (
                  <p key="lead" className="break-words text-sm font-medium text-ink">
                    <Link
                      href={`/leads/${l.id}`}
                      className="text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {l.fullName}
                    </Link>
                    <span className="break-all font-normal text-ink-2"> · {l.email}</span>
                  </p>
                )}
                <p className="mt-0.5 text-xs text-ink-3">
                  {[
                    showPerson && l.person
                      ? t("crm.leads.person", {
                          person: l.person.displayName ?? t("crm.people.anonymisedPerson"),
                        })
                      : null,
                    l.company ? t("crm.leads.typedCompany", { company: l.company }) : null,
                    sourceLabel(l.source, t),
                    t("crm.leads.lastRequest", { date: date.format(new Date(l.lastRequestAt)) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {showPerson && l.person ? (
                  <p className="mt-1 text-xs">
                    <Link
                      href={`/crm/people/${l.person.id}`}
                      className="text-petrol-strong underline-offset-2 hover:underline"
                    >
                      {t("crm.leads.openPerson")}
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusPill tone={STATUS_TONE[l.status]}>{statusLabel(l.status, t)}</StatusPill>
                <span className="text-xs text-ink-3">
                  {l.assignedTo ? (
                    <span
                      key="assignee"
                      className={l.assignedTo.active ? undefined : "line-through"}
                    >
                      {t("crm.leads.assignedTo", { name: l.assignedTo.displayName })}
                    </span>
                  ) : (
                    <span key="unassigned">{t("crm.leads.unassigned")}</span>
                  )}
                </span>
              </div>
            </div>
            {requests.length > 0 ? (
              <ul key="requests" className="mt-3 divide-y divide-line border-t border-line">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
                  >
                    <StatusPill tone={r.kind === "document" ? "petrol" : "neutral"}>
                      {r.kind === "document"
                        ? t("crm.leads.documentRequest")
                        : t("crm.leads.contactMessage")}
                    </StatusPill>
                    <span className="min-w-0 flex-1 break-words text-ink">
                      {r.text || t("crm.common.notSet")}
                      {r.detail ? <span className="text-ink-3"> · {r.detail}</span> : null}
                    </span>
                    <time dateTime={r.at} className="shrink-0 text-xs tabular-nums text-ink-3">
                      {date.format(new Date(r.at))}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p key="no-requests" className="mt-3 border-t border-line pt-2 text-sm text-ink-3">
                {t("crm.leads.noRequests")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
