"use client";
/**
 * CRM-2 (ADR-032 D6): the CRM panel of a lead — the person behind it, the person's other leads
 * and company — and, for staff with crm:manage on the lead's site, adding the person to a
 * company, removing it, joining this lead to another lead of the same person and separating it
 * again. Nothing happens automatically; the API and the database decide (same site, live leads).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { CrmCompanySummary, CrmLeadCandidate, CrmPerson } from "@dream/contracts";
import {
  addPersonToCompany,
  leadCandidates,
  searchCompanies,
  setLeadPerson,
  setPersonCompany,
} from "../../lib/crm-client";
import { FIELD, FormMessage } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, Spinner } from "../ui";

type Message = { kind: "error" | "success"; text: string } | null;

export function LeadPerson({
  leadId,
  siteId,
  person,
  canManage,
  anonymised,
}: {
  leadId: string;
  siteId: string;
  person: CrmPerson | null;
  canManage: boolean;
  anonymised: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const others = person?.leads.filter((l) => l.id !== leadId) ?? [];
  const editable = canManage && !anonymised;

  async function run(key: string, action: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(key);
    setMessage(null);
    const res = await action();
    setBusy(null);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message ?? t("crm.errors.linkFailed") });
      return;
    }
    setMessage({ kind: "success", text: t("crm.leadPanel.saved") });
    router.refresh();
  }

  return (
    <div className="space-y-5 text-sm">
      {person ? (
        <dl key="person" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-ink-3">{t("crm.leadPanel.person")}</dt>
            <dd className="mt-0.5 break-words text-ink">
              <Link
                href={`/crm/people/${person.id}`}
                className="font-medium text-petrol-strong underline-offset-2 hover:underline"
              >
                {person.displayName ?? t("crm.people.anonymisedPerson")}
              </Link>
              <span className="text-ink-3"> · {t("crm.leadPanel.openProfile")}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">{t("crm.leadPanel.company")}</dt>
            <dd className="mt-0.5 break-words text-ink">
              {person.company ? (
                <Link
                  key="company"
                  href={`/crm/companies/${person.company.id}`}
                  className="text-petrol-strong underline-offset-2 hover:underline"
                >
                  {person.company.name}
                </Link>
              ) : (
                <span key="none" className="text-ink-3">
                  {t("crm.leadPanel.noCompany")}
                </span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">{t("crm.leadPanel.otherLeads")}</dt>
            <dd className="mt-0.5 text-ink">
              {others.length === 0 ? (
                <span key="none" className="text-ink-3">
                  {t("crm.leadPanel.noOtherLeads")}
                </span>
              ) : (
                <ul key="list" className="space-y-1">
                  {others.map((l) => (
                    <li key={l.id} className="break-all">
                      {l.anonymised ? (
                        <span key="anon" className="text-ink-3">
                          {t("crm.people.anonymisedLead")}
                        </span>
                      ) : (
                        <Link
                          key="lead"
                          href={`/leads/${l.id}`}
                          className="text-petrol-strong underline-offset-2 hover:underline"
                        >
                          {l.email}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p key="no-person" className="text-ink-3">
          {t("crm.leadPanel.noPerson")}
        </p>
      )}
      {message ? (
        <FormMessage key={`msg-${message.kind}`} kind={message.kind}>
          <span>{message.text}</span>
        </FormMessage>
      ) : null}
      {editable ? (
        // A new key after every saved change resets the searches (the answer changed the person).
        <div
          key={`actions-${person?.id ?? "none"}-${person?.version ?? 0}-${others.length}`}
          className="space-y-5"
        >
          <CompanyPicker
            siteId={siteId}
            current={person?.company?.id ?? null}
            busy={busy}
            onPick={(c) =>
              run(`company-${c.id}`, () =>
                addPersonToCompany(c.id, {
                  leadId,
                  ...(person?.company ? { confirmMove: true } : {}),
                }),
              )
            }
          />
          <LeadPicker
            leadId={leadId}
            busy={busy}
            onPick={(c) =>
              run(`lead-${c.id}`, () => setLeadPerson(leadId, { samePersonAsLeadId: c.id }))
            }
          />
          {person ? (
            <div key="person-actions" className="flex flex-wrap gap-2">
              {person.company ? (
                <button
                  key="remove"
                  type="button"
                  className={buttonStyles.ghost}
                  disabled={busy !== null}
                  onClick={() =>
                    void run("remove", () =>
                      setPersonCompany(person.id, { companyId: null, version: person.version }),
                    )
                  }
                >
                  {busy === "remove" ? <Spinner key="busy" /> : null}
                  <span>{t("crm.leadPanel.removeFromCompany")}</span>
                </button>
              ) : null}
              {others.length > 0 ? (
                <button
                  key="separate"
                  type="button"
                  className={buttonStyles.ghost}
                  title={t("crm.leadPanel.separateHint")}
                  disabled={busy !== null}
                  onClick={() =>
                    void run("separate", () => setLeadPerson(leadId, { samePersonAsLeadId: null }))
                  }
                >
                  {busy === "separate" ? <Spinner key="busy" /> : null}
                  <span>{t("crm.leadPanel.separate")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p key="read-only" className="text-ink-3">
          {anonymised ? t("crm.leadPanel.anonymised") : t("crm.leadPanel.readOnly")}
        </p>
      )}
    </div>
  );
}

function CompanyPicker({
  siteId,
  current,
  busy,
  onPick,
}: {
  siteId: string;
  current: string | null;
  busy: string | null;
  onPick: (c: CrmCompanySummary) => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CrmCompanySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    const res = await searchCompanies(siteId, q.trim());
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems(res.data.items.filter((c) => c.id !== current).slice(0, 10));
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t("crm.leadPanel.companySearchLabel")}
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("crm.leadPanel.companySearchPlaceholder")}
          maxLength={100}
          autoComplete="off"
          className={FIELD}
        />
        <button type="submit" className={buttonStyles.secondary} disabled={loading}>
          {loading ? <Spinner key="busy" /> : null}
          <span>{t("crm.leadPanel.companySearchLabel")}</span>
        </button>
      </form>
      {error ? (
        <FormMessage key="error" kind="error">
          <span>{error}</span>
        </FormMessage>
      ) : null}
      {items ? (
        items.length === 0 ? (
          <p key="none" className="text-ink-3">
            {t("crm.leadPanel.noCompanies")}
          </p>
        ) : (
          <ul key="list" className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 break-words text-ink">
                  {[c.name, c.city, c.country, c.registrationId].filter(Boolean).join(" · ")}
                </span>
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  disabled={busy !== null}
                  onClick={() => void onPick(c)}
                >
                  {busy === `company-${c.id}` ? <Spinner key="busy" /> : null}
                  <span>
                    {current ? t("crm.leadPanel.moveToCompany") : t("crm.leadPanel.addToCompany")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function LeadPicker({
  leadId,
  busy,
  onPick,
}: {
  leadId: string;
  busy: string | null;
  onPick: (c: CrmLeadCandidate) => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CrmLeadCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    const res = await leadCandidates(leadId, q.trim());
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems(res.data.items);
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t("crm.leadPanel.leadSearchLabel")}
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("crm.leadPanel.leadSearchPlaceholder")}
          maxLength={100}
          autoComplete="off"
          className={FIELD}
        />
        <button type="submit" className={buttonStyles.secondary} disabled={loading}>
          {loading ? <Spinner key="busy" /> : null}
          <span>{t("crm.leadPanel.leadSearchLabel")}</span>
        </button>
      </form>
      {error ? (
        <FormMessage key="error" kind="error">
          <span>{error}</span>
        </FormMessage>
      ) : null}
      {items ? (
        items.length === 0 ? (
          <p key="none" className="text-ink-3">
            {t("crm.people.noResults")}
          </p>
        ) : (
          <ul key="list" className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 break-words text-ink">
                  <span className="font-medium">{c.fullName}</span>{" "}
                  <span className="break-all text-ink-2">{c.email}</span>
                  {c.person?.company ? (
                    <span key="company" className="block text-xs text-ink-3">
                      {t("crm.people.atCompany", { company: c.person.company.name })}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  disabled={busy !== null}
                  onClick={() => void onPick(c)}
                >
                  {busy === `lead-${c.id}` ? <Spinner key="busy" /> : null}
                  <span>{t("crm.leadPanel.samePerson")}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
