"use client";
/**
 * CRM-2 (ADR-032 D6): the people of a company, each with its leads, and — for staff with
 * crm:manage on the site — adding a person from a lead (suggestions or a search) and removing a
 * person from the company. Nothing is linked automatically: every suggestion needs a click. The
 * API and the database decide (same site, live leads only, optimistic concurrency).
 *
 * Dates are formatted on the server (`dates`, by lead id): the browser's ICU data differs from
 * Node's, which would break hydration. Search results only exist in the browser.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { CrmLeadCandidate, CrmPerson } from "@dream/contracts";
import { addPersonToCompany, companyCandidates, setPersonCompany } from "../../lib/crm-client";
import { FIELD, FormMessage } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, Spinner, StatusPill } from "../ui";

type Message = { kind: "error" | "success"; text: string } | null;

export function CompanyPeople({
  companyId,
  people,
  dates,
  statusLabels,
  canManage,
}: {
  companyId: string;
  people: readonly CrmPerson[];
  /** "Last request …" per lead id, formatted on the server. */
  dates: Readonly<Record<string, string>>;
  /** Lead status labels in the UI language. */
  statusLabels: Readonly<Record<string, string>>;
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  // The suggestions are loaded when the add panel opens (null: closed).
  const [adding, setAdding] = useState<CrmLeadCandidate[] | null>(null);
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    setMessage(null);
    const res = await companyCandidates(companyId, "");
    setOpening(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    setAdding(res.data.items);
  }

  async function remove(person: CrmPerson) {
    setBusy(person.id);
    setMessage(null);
    const res = await setPersonCompany(person.id, { companyId: null, version: person.version });
    setBusy(null);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {people.length === 0 ? (
        <div key="empty" className="rounded-xl border border-dashed border-line-strong p-4">
          <p className="text-sm font-medium text-ink">{t("crm.people.empty")}</p>
          <p className="mt-1 text-sm text-ink-3">{t("crm.people.emptyText")}</p>
        </div>
      ) : (
        <ul key="list" className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-ink">
                  <Link
                    href={`/crm/people/${p.id}`}
                    className="text-ink underline-offset-2 hover:text-petrol-strong hover:underline"
                  >
                    {p.displayName ?? t("crm.people.anonymisedPerson")}
                  </Link>
                </p>
                <ul className="mt-1 space-y-1">
                  {p.leads.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                      {l.anonymised ? (
                        <span key="anon" className="text-ink-3">
                          {t("crm.people.anonymisedLead")}
                        </span>
                      ) : (
                        <Link
                          key="lead"
                          href={`/leads/${l.id}`}
                          className="break-all text-petrol-strong underline-offset-2 hover:underline"
                        >
                          {l.email}
                        </Link>
                      )}
                      <StatusPill tone="neutral">{statusLabels[l.status] ?? l.status}</StatusPill>
                      <span className="text-xs text-ink-3">{dates[l.id]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {canManage ? (
                <button
                  key="remove"
                  type="button"
                  className={buttonStyles.ghost}
                  disabled={busy !== null}
                  onClick={() => void remove(p)}
                >
                  {busy === p.id ? <Spinner key="busy" /> : null}
                  <span>{busy === p.id ? t("crm.people.removing") : t("crm.people.remove")}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <FormMessage key={`msg-${message.kind}`} kind={message.kind}>
          <span>{message.text}</span>
        </FormMessage>
      ) : null}
      {canManage ? (
        adding ? (
          <AddPerson
            key="add"
            companyId={companyId}
            suggestions={adding}
            onClose={() => setAdding(null)}
            onAdded={() => {
              setMessage({ kind: "success", text: t("crm.people.added") });
              router.refresh();
            }}
          />
        ) : (
          <button
            key="open"
            type="button"
            className={buttonStyles.secondary}
            disabled={opening}
            onClick={() => void open()}
          >
            {opening ? <Spinner key="busy" /> : null}
            <span>{t("crm.people.add")}</span>
          </button>
        )
      ) : null}
    </div>
  );
}

function AddPerson({
  companyId,
  suggestions,
  onClose,
  onAdded,
}: {
  companyId: string;
  suggestions: CrmLeadCandidate[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CrmLeadCandidate[] | null>(suggestions);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(query: string) {
    setLoading(true);
    setError(null);
    const res = await companyCandidates(companyId, query.trim());
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems(res.data.items);
    setSearched(query.trim() !== "");
  }

  async function add(c: CrmLeadCandidate) {
    setBusy(c.id);
    setError(null);
    const move = Boolean(c.person?.company && c.person.company.id !== companyId);
    const res = await addPersonToCompany(companyId, {
      leadId: c.id,
      ...(move ? { confirmMove: true } : {}),
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems((list) => (list ?? []).filter((i) => i.id !== c.id));
    onAdded();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void load(q);
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">{t("crm.people.addTitle")}</p>
        <button type="button" className={buttonStyles.ghost} onClick={onClose}>
          <span>{t("crm.people.close")}</span>
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t("crm.people.searchLabel")}
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("crm.people.searchPlaceholder")}
          maxLength={100}
          autoComplete="off"
          className={FIELD}
        />
        <button type="submit" className={buttonStyles.secondary} disabled={loading}>
          {loading ? <Spinner key="busy" /> : null}
          <span>{loading ? t("crm.people.searching") : t("crm.people.search")}</span>
        </button>
      </form>
      {error ? (
        <FormMessage key="error" kind="error">
          <span>{error}</span>
        </FormMessage>
      ) : null}
      {items ? (
        <div key="items">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {searched ? t("crm.people.results") : t("crm.people.suggestions")}
          </p>
          {items.length === 0 ? (
            <p key="none" className="mt-2 text-sm text-ink-3">
              {searched ? t("crm.people.noResults") : t("crm.people.noSuggestions")}
            </p>
          ) : (
            <ul key="list" className="mt-2 divide-y divide-line">
              {items.map((c) => {
                const elsewhere =
                  c.person?.company && c.person.company.id !== companyId ? c.person.company : null;
                return (
                  <li key={c.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="break-words font-medium text-ink">{c.fullName}</p>
                      <p className="break-all text-ink-2">{c.email}</p>
                      <p className="flex flex-wrap gap-2 text-xs text-ink-3">
                        {c.company ? <span key="typed">{c.company}</span> : null}
                        {c.reason ? (
                          <span key="reason">
                            {c.reason === "email_domain"
                              ? t("crm.people.reasonEmailDomain")
                              : t("crm.people.reasonCompanyName")}
                          </span>
                        ) : null}
                        {elsewhere ? (
                          <span key="elsewhere">
                            {t("crm.people.atCompany", { company: elsewhere.name })}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={buttonStyles.secondary}
                      disabled={busy !== null}
                      onClick={() => void add(c)}
                    >
                      {busy === c.id ? <Spinner key="busy" /> : null}
                      <span>
                        {elsewhere ? t("crm.people.moveButton") : t("crm.people.addButton")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
