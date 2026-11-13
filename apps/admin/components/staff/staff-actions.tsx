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
import { assignRole, endOfDayIso, inviteStaff, revokeRole, stepUp } from "../../lib/staff-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { buttonStyles, cx, Spinner } from "../ui";

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
    const who = people.find((p) => p.id === person)?.displayName ?? "The person";
    setMessage({ kind: "success", text: `${who} now has the role ${role.name}.` });
    setEnd("");
    router.refresh();
  }

  if (!usable.length) {
    return (
      <p className="text-sm text-ink-3">Your roles do not allow you to give roles to others.</p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Give a role">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Staff member" htmlFor={ids.person}>
          <select
            id={ids.person}
            required
            className={FIELD}
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">Choose a person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" htmlFor={ids.role} hint={role?.description}>
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
            <option value="">Choose a role…</option>
            {usable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
                {r.customerData ? " · lead data" : ""}
              </option>
            ))}
          </select>
        </Field>
        {needsSite ? (
          <Field label="Site" htmlFor={ids.site}>
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
        <Field label="Ends on (optional)" htmlFor={ids.end} hint="Empty: no end date.">
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
        Give role
      </button>
    </form>
  );
}

export function RemoveRoleButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const router = useRouter();
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
            aria-label={`Confirm removing ${label}`}
          >
            {busy ? <Spinner size={12} /> : null}
            Remove
          </button>
          <button
            type="button"
            className={cx(buttonStyles.ghost, "h-8 text-sm")}
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={cx(buttonStyles.ghost, "h-8 px-2 text-sm text-danger")}
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${label}`}
        >
          Remove
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
    <form onSubmit={submit} className="space-y-4" aria-label="Invite a staff member">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="E-mail" htmlFor={ids.email}>
          <input
            id={ids.email}
            type="email"
            required
            className={FIELD}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Name" htmlFor={ids.name}>
          <input
            id={ids.name}
            required
            maxLength={200}
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Site" htmlFor={ids.site}>
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
        <Field label="Role (optional)" htmlFor={ids.role}>
          <select
            id={ids.role}
            className={FIELD}
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
          >
            <option value="">No role yet</option>
            {siteRoles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {needCode ? (
        <Field
          label="Authenticator code"
          htmlFor={ids.code}
          hint="Inviting someone needs a fresh confirmation."
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
          Invitation created. Send this one-time enrolment link to the person (it is shown only
          once): <span className="break-all font-mono text-xs">{link}</span>
        </FormMessage>
      ) : null}
      <button
        type="submit"
        className={buttonStyles.secondary}
        disabled={busy || (needCode && code.replace(/\s/g, "").length !== 6)}
      >
        {busy ? <Spinner size={14} /> : null}
        {needCode ? "Confirm and invite" : "Invite"}
      </button>
    </form>
  );
}
