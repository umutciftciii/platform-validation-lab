"use client";
/**
 * Create or edit a CRM company (CRM-1, ADR-032). Every field is sent together; the API and the
 * database decide (crm:manage on the site, unique name per site, account owner with crm:manage,
 * optimistic concurrency). Shown only to callers the API lets manage the site.
 *
 * The country names come from the server (`countries`): Node and the browser ship different ICU
 * data (names and sort order differ), so computing them here would break hydration.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import {
  CRM_COMPANY_LIMITS,
  type CrmCompany,
  type CrmCompanyCreateInput,
  type CrmCompanyField,
  type CrmOwnerCandidate,
  type CrmSite,
} from "@dream/contracts";
import { createCompany, updateCompany } from "../../lib/crm-client";
import { Field, FIELD, FormMessage, TEXTAREA } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, Spinner } from "../ui";

type Values = Record<Exclude<CrmCompanyField, "ownerUserId">, string> & { ownerUserId: string };
type Message = { kind: "error" | "success"; text: string } | null;
type CountryOption = { code: string; name: string };

const EMPTY: Values = {
  name: "",
  country: "",
  city: "",
  address: "",
  website: "",
  phone: "",
  email: "",
  description: "",
  internalNotes: "",
  ownerUserId: "",
};

function valuesOf(c: CrmCompany | undefined): Values {
  if (!c) return EMPTY;
  return {
    name: c.name,
    country: c.country ?? "",
    city: c.city ?? "",
    address: c.address ?? "",
    website: c.website ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    description: c.description ?? "",
    internalNotes: c.internalNotes ?? "",
    ownerUserId: c.owner?.id ?? "",
  };
}

export function CompanyForm(
  props:
    | {
        mode: "create";
        sites: readonly CrmSite[];
        ownersBySite: Readonly<Record<string, readonly CrmOwnerCandidate[]>>;
        viewerId: string;
        countries: readonly CountryOption[];
      }
    | {
        mode: "edit";
        company: CrmCompany;
        owners: readonly CrmOwnerCandidate[];
        countries: readonly CountryOption[];
      },
) {
  const t = useT();
  const router = useRouter();
  const base = useId();
  const id = (f: string) => `${base}-${f}`;
  const initial = props.mode === "edit" ? valuesOf(props.company) : EMPTY;
  const [values, setValues] = useState<Values>(() =>
    props.mode === "create"
      ? {
          ...EMPTY,
          // The creator owns the new company when allowed to (most often the case).
          ownerUserId: (props.ownersBySite[props.sites[0]?.id ?? ""] ?? []).some(
            (o) => o.id === props.viewerId,
          )
            ? props.viewerId
            : "",
        }
      : initial,
  );
  const [siteId, setSiteId] = useState(props.mode === "create" ? (props.sites[0]?.id ?? "") : "");
  const [version, setVersion] = useState(props.mode === "edit" ? props.company.version : 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const { countries } = props;

  const owners: readonly CrmOwnerCandidate[] =
    props.mode === "create" ? (props.ownersBySite[siteId] ?? []) : props.owners;
  // A current owner who lost access stays visible as the current value.
  const current = props.mode === "edit" ? props.company.owner : null;
  const lostOwner = current && !owners.some((o) => o.id === current.id) ? current : null;
  const dirty =
    props.mode === "create" ||
    (Object.keys(values) as (keyof Values)[]).some((k) => values[k] !== initial[k]);

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setMessage(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setInvalid(null);
    const fields = {
      ...values,
      // A code from the country picker (or "" for none); the API validates it again.
      country: values.country as CrmCompanyCreateInput["country"],
      ownerUserId: values.ownerUserId || null,
    };
    const res =
      props.mode === "create"
        ? await createCompany({ siteId, ...fields })
        : await updateCompany(props.company.id, { version, ...fields });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      setInvalid(res.field);
      return;
    }
    if (props.mode === "create") {
      router.push(`/crm/companies/${res.data.company.id}`);
      return;
    }
    setVersion(res.data.company.version);
    setMessage({ kind: "success", text: t("crm.form.saved") });
    router.refresh();
  }

  const text = (
    key: Exclude<keyof Values, "ownerUserId" | "country">,
    opts: { type?: string; hint?: string; multiline?: boolean; autoComplete?: string } = {},
  ) => (
    <Field
      label={t(`crm.form.${key}`)}
      htmlFor={id(key)}
      {...(opts.hint ? { hint: opts.hint } : {})}
      className={opts.multiline ? "sm:col-span-2" : undefined}
    >
      {opts.multiline ? (
        <textarea
          id={id(key)}
          value={values[key]}
          onChange={(e) => set(key)(e.target.value)}
          maxLength={CRM_COMPANY_LIMITS[key]}
          aria-invalid={invalid === key || undefined}
          className={TEXTAREA}
          rows={key === "address" ? 3 : 4}
        />
      ) : (
        <input
          id={id(key)}
          type={opts.type ?? "text"}
          value={values[key]}
          onChange={(e) => set(key)(e.target.value)}
          maxLength={CRM_COMPANY_LIMITS[key]}
          required={key === "name"}
          autoComplete={opts.autoComplete ?? "off"}
          aria-invalid={invalid === key || undefined}
          className={FIELD}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {props.mode === "create" && props.sites.length > 1 ? (
          <Field label={t("crm.form.site")} htmlFor={id("site")} className="sm:col-span-2">
            <select
              id={id("site")}
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setValues((v) => ({ ...v, ownerUserId: "" }));
              }}
              aria-invalid={invalid === "siteId" || undefined}
              className={FIELD}
            >
              {props.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {text("name", { hint: t("crm.form.nameHint"), autoComplete: "organization" })}
        <Field label={t("crm.form.owner")} htmlFor={id("owner")} hint={t("crm.form.ownerHint")}>
          <select
            id={id("owner")}
            value={values.ownerUserId}
            onChange={(e) => set("ownerUserId")(e.target.value)}
            aria-invalid={invalid === "ownerUserId" || undefined}
            className={FIELD}
          >
            <option value="">{t("crm.common.noOwner")}</option>
            {lostOwner ? (
              <option key={`lost-${lostOwner.id}`} value={lostOwner.id}>
                {`${lostOwner.displayName} ${t("crm.common.noLongerAccess")}`}
              </option>
            ) : null}
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("crm.form.country")} htmlFor={id("country")}>
          <select
            id={id("country")}
            value={values.country}
            onChange={(e) => set("country")(e.target.value)}
            aria-invalid={invalid === "country" || undefined}
            className={FIELD}
          >
            <option value="">{t("crm.form.noCountry")}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {text("city", { autoComplete: "address-level2" })}
        {text("address", { multiline: true })}
        {text("website", { type: "url", hint: t("crm.form.websiteHint") })}
        {text("phone", { type: "tel" })}
        {text("email", { type: "email", hint: t("crm.form.emailHint") })}
        {text("description", { multiline: true })}
        {text("internalNotes", { multiline: true, hint: t("crm.form.internalNotesHint") })}
      </div>
      {message ? (
        <FormMessage key={`msg-${message.kind}`} kind={message.kind}>
          <span>{message.text}</span>
        </FormMessage>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className={buttonStyles.primary}
          disabled={busy || !dirty || values.name.trim() === ""}
        >
          {busy ? <Spinner key="busy" /> : null}
          <span>
            {props.mode === "create"
              ? busy
                ? t("crm.form.creating")
                : t("crm.form.create")
              : busy
                ? t("crm.form.saving")
                : t("crm.form.save")}
          </span>
        </button>
        {props.mode === "edit" && dirty ? (
          <button
            key="discard"
            type="button"
            className={buttonStyles.ghost}
            disabled={busy}
            onClick={() => {
              setValues(initial);
              setMessage(null);
              setInvalid(null);
            }}
          >
            <span>{t("crm.form.discard")}</span>
          </button>
        ) : null}
      </div>
    </form>
  );
}
