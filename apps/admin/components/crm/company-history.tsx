/**
 * CRM-2 (ADR-032 D7): the history of a company — creation, account owner changes, people joining,
 * moving and leaving, lead links of its people and staff notes — newest first. Rendered on the
 * server; the rows are written by the database (notes by staff with crm:manage).
 */
import type { CrmActivity } from "@dream/contracts";
import type { Translate } from "../../lib/i18n/types";

function sentence(a: CrmActivity, companyId: string, t: Translate): string {
  const name = a.actor.displayName;
  const person = a.person?.displayName ?? t("crm.history.unnamedPerson");
  switch (a.kind) {
    case "NOTE":
      return t("crm.history.note", { name });
    case "COMPANY_CREATED":
      return t("crm.history.created", { name });
    case "COMPANY_OWNER_CHANGED":
      return a.toOwner
        ? t("crm.history.ownerSet", { name, owner: a.toOwner.displayName })
        : t("crm.history.ownerRemoved", { name });
    case "PERSON_COMPANY_CHANGED":
      if (a.toCompany?.id === companyId) return t("crm.history.personAdded", { name, person });
      if (a.toCompany) {
        return t("crm.history.personMoved", { name, person, company: a.toCompany.name });
      }
      return t("crm.history.personRemoved", { name, person });
    case "LEAD_PERSON_CHANGED": {
      const lead = a.lead?.label ?? t("crm.history.unnamedLead");
      return a.toPerson
        ? t("crm.history.leadJoined", { name, lead, person })
        : t("crm.history.leadSeparated", { name, lead, person });
    }
  }
}

export function CompanyHistory({
  items,
  companyId,
  t,
  date,
}: {
  items: readonly CrmActivity[];
  companyId: string;
  t: Translate;
  date: Intl.DateTimeFormat;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-3">{t("crm.history.empty")}</p>;
  }
  return (
    <ol className="space-y-4">
      {items.map((a) => (
        <li key={a.id} className="border-l-2 border-line pl-4">
          <p className="break-words text-sm text-ink">{sentence(a, companyId, t)}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            <time dateTime={a.createdAt}>{date.format(new Date(a.createdAt))}</time>
          </p>
          {a.body ? (
            <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
              {a.body}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
