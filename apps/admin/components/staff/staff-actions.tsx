"use client";
/**
 * Interactive parts of "Staff and access" (DP-076 revision, DP-107; ADR-017 v2): give a role
 * (person → role → site → give), remove a role, invite a staff member. Role changes need only the
 * sign-in MFA; an invitation keeps its step-up, so that form can ask for an authenticator code.
 * The API decides every change (no-escalation, site scope, last administrator).
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { AssignableRole, StaffMember, StaffSite } from "@dream/contracts";
import { staff as STAFF_EN } from "../../lib/i18n/messages/staff/en";
import type { Translate } from "../../lib/i18n/types";
import { assignRole, endOfDayIso, inviteStaff, revokeRole, stepUp } from "../../lib/staff-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, cx, Spinner } from "../ui";

type RoleKey = keyof typeof STAFF_EN.roles;

/**
 * ML-12e: a role's name or description in the UI language, by its key, only while the API still
 * sends the dictionary's English text; a renamed or unknown role shows the API's own text.
 */
function roleText(key: string, field: "name" | "description", apiText: string, t: Translate) {
  return Object.hasOwn(STAFF_EN.roles, key) && STAFF_EN.roles[key as RoleKey][field] === apiText
    ? t(`staff.roles.${key as RoleKey}.${field}`)
    : apiText;
}

export function AssignRoleForm({
  staff,
  roles,
  sites,
  viewerId,
}: {
  staff: readonly StaffMember[];
  roles: readonly AssignableRole[];
  sites: readonly StaffSite[];
  viewerId: string;
}) {
  const router = useRouter();
  const t = useT();
  const ids = { person: useId(), role: useId(), site: useId(), end: useId() };
  const people = staff.filter((s) => s.id !== viewerId && s.status !== "DEACTIVATED");
  const usable = roles.filter((r) => r.platform || r.siteIds.length > 0);
  const [person, setPerson] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [siteId, setSiteId] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const role = usable.find((r) => r.key === roleKey);
  const roleSites = role ? sites.filter((s) => role.siteIds.includes(s.id)) : [];
  const needsSite = role?.scopeType === "SITE";
  const effectiveSite = needsSite ? siteId || roleSites[0]?.id || "" : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!person || !role) return;
    setBusy(true);
    setMessage(null);
    const expiresAt = end ? endOfDayIso(end) : undefined;
    const res = await assignRole(person, {
      roleKey: role.key,
      ...(needsSite ? { siteId: effectiveSite } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    const who = people.find((p) => p.id === person)?.displayName ?? t("staff.assign.someone");
    setMessage({
      kind: "success",
      text: t("staff.assign.success", {
        name: who,
        role: roleText(role.key, "name", role.name, t),
      }),
    });
    setEnd("");
    router.refresh();
  }

  if (!usable.length) {
    return <p className="text-sm text-ink-3">{t("staff.assign.noRoles")}</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-label={t("staff.assign.form")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("staff.assign.person")} htmlFor={ids.person}>
          <select
            id={ids.person}
            required
            className={FIELD}
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">{t("staff.assign.choosePerson")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.email})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("staff.assign.role")}
          htmlFor={ids.role}
          hint={role ? roleText(role.key, "description", role.description, t) : undefined}
        >
          <select
            id={ids.role}
            required
            className={FIELD}
            value={roleKey}
            onChange={(e) => {
              setRoleKey(e.target.value);
              setSiteId("");
            }}
          >
            <option value="">{t("staff.assign.chooseRole")}</option>
            {usable.map((r) => (
              <option key={r.key} value={r.key}>
                {roleText(r.key, "name", r.name, t)}
                {r.customerData ? t("staff.assign.leadData") : ""}
              </option>
            ))}
          </select>
        </Field>
        {needsSite ? (
          <Field label={t("staff.assign.site")} htmlFor={ids.site}>
            <select
              id={ids.site}
              required
              className={FIELD}
              value={effectiveSite}
              onChange={(e) => setSiteId(e.target.value)}
            >
              {roleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="hidden lg:block" aria-hidden="true" />
        )}
        <Field label={t("staff.assign.end")} htmlFor={ids.end} hint={t("staff.assign.endHint")}>
          <input
            id={ids.end}
            type="date"
            className={FIELD}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <button type="submit" className={buttonStyles.primary} disabled={busy || !person || !role}>
        {busy ? <Spinner size={14} /> : null}
        <span>{t("staff.assign.submit")}</span>
      </button>
    </form>
  );
}

export function RemoveRoleButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const router = useRouter();
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    const res = await revokeRole(assignmentId);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {confirming ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            className={cx(buttonStyles.primary, "h-8 px-3 text-sm")}
            disabled={busy}
            onClick={() => void remove()}
            aria-label={t("staff.remove.confirmLabel", { label })}
          >
            {busy ? <Spinner size={12} /> : null}
            <span>{t("staff.remove.remove")}</span>
          </button>
          <button
            type="button"
            className={cx(buttonStyles.ghost, "h-8 text-sm")}
            onClick={() => setConfirming(false)}
          >
            {t("staff.remove.keep")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={cx(buttonStyles.ghost, "h-8 px-2 text-sm text-danger")}
          onClick={() => setConfirming(true)}
          aria-label={t("staff.remove.removeLabel", { label })}
        >
          {t("staff.remove.remove")}
        </button>
      )}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function InviteForm({
  sites,
  roles,
}: {
  sites: readonly StaffSite[];
  roles: readonly AssignableRole[];
}) {
  const router = useRouter();
  const t = useT();
  const ids = { email: useId(), name: useId(), site: useId(), role: useId(), code: useId() };
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [roleKey, setRoleKey] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const siteRoles = roles.filter(
    (r) => (r.scopeType === "SITE" && r.siteIds.includes(siteId)) || r.platform,
  );

  async function send() {
    setBusy(true);
    setError(null);
    const res = await inviteStaff({
      email: email.trim().toLowerCase(),
      displayName: name.trim(),
      siteId,
      ...(roleKey ? { roleKey } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setNeedCode(false);
      setLink(res.data.enrolmentLink);
      setEmail("");
      setName("");
      setRoleKey("");
      router.refresh();
      return;
    }
    if (res.stepUp) {
      setNeedCode(true);
      return;
    }
    setError(res.message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLink(null);
    if (needCode) {
      setBusy(true);
      const up = await stepUp(code.replace(/\s/g, ""));
      setBusy(false);
      setCode("");
      if (!up.ok) {
        setError(up.message);
        return;
      }
    }
    await send();
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={t("staff.invite.form")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("staff.invite.email")} htmlFor={ids.email}>
          <input
            id={ids.email}
            type="email"
            required
            className={FIELD}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t("staff.invite.name")} htmlFor={ids.name}>
          <input
            id={ids.name}
            required
            maxLength={200}
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("staff.invite.site")} htmlFor={ids.site}>
          <select
            id={ids.site}
            className={FIELD}
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setRoleKey("");
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("staff.invite.role")} htmlFor={ids.role}>
          <select
            id={ids.role}
            className={FIELD}
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
          >
            <option value="">{t("staff.invite.noRole")}</option>
            {siteRoles.map((r) => (
              <option key={r.key} value={r.key}>
                {roleText(r.key, "name", r.name, t)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {needCode ? (
        <Field
          label={t("staff.invite.code")}
          htmlFor={ids.code}
          hint={t("staff.invite.codeHint")}
          className="max-w-xs"
        >
          <input
            id={ids.code}
            className={FIELD}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {link ? (
        <FormMessage kind="success">
          {t("staff.invite.created")}
          <span className="break-all font-mono text-xs">{link}</span>
        </FormMessage>
      ) : null}
      <button
        type="submit"
        className={buttonStyles.secondary}
        disabled={busy || (needCode && code.replace(/\s/g, "").length !== 6)}
      >
        {busy ? <Spinner size={14} /> : null}
        <span>{needCode ? t("staff.invite.confirmSubmit") : t("staff.invite.submit")}</span>
      </button>
    </form>
  );
}
