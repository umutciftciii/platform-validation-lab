"use client";
/**
 * Interactive parts of a lead (DP-041; ADR-019): move the status, (re)assign the lead, add a note
 * or record a contact. Shown only when the API says `canManage` (lead:manage on the lead's site,
 * lead not anonymised); the API and the database decide every change again.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import {
  LEAD_CONTACT_CHANNELS,
  LEAD_NOTE_MAX,
  LEAD_STATUS_TRANSITIONS,
  type LeadAssignee,
  type LeadContactChannel,
  type LeadStatus,
} from "@dream/contracts";
import {
  addLeadActivity,
  changeLeadWorkflow,
  localDateTimeToIso,
  nowLocalDateTime,
} from "../../lib/leads-client";
import { CHANNEL_LABEL, STATUS_HINT, STATUS_LABEL } from "../../lib/leads-view";
import { Field, FIELD, FormMessage, TEXTAREA } from "../catalog/parts";
import { buttonStyles, cx, Spinner } from "../ui";

type Message = { kind: "error" | "success"; text: string } | null;

export function LeadWorkflowForm({
  leadId,
  status,
  assignedToId,
  version,
  assignees,
  viewerId,
}: {
  leadId: string;
  status: LeadStatus;
  assignedToId: string | null;
  version: number;
  assignees: readonly LeadAssignee[];
  viewerId: string;
}) {
  const router = useRouter();
  const ids = { status: useId(), assignee: useId(), note: useId() };
  const next = LEAD_STATUS_TRANSITIONS[status];
  const [to, setTo] = useState<"" | LeadStatus>("");
  const [assignee, setAssignee] = useState(assignedToId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const assigneeChanged = assignee !== (assignedToId ?? "");
  const dirty = to !== "" || assigneeChanged;
  // The current assignee may have lost access: keep them visible as the current value.
  const knownCurrent = !assignedToId || assignees.some((a) => a.id === assignedToId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setMessage(null);
    const res = await changeLeadWorkflow(leadId, {
      version,
      ...(to ? { status: to } : {}),
      ...(assigneeChanged ? { assignedToId: assignee || null } : {}),
      ...(note.trim() ? { note } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    setTo("");
    setNote("");
    setMessage({ kind: "success", text: "Saved. The change is in the activity history." });
    router.refresh();
  }

  function assignToMe() {
    if (assignees.some((a) => a.id === viewerId)) setAssignee(viewerId);
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Change status or assignment">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Move to"
          htmlFor={ids.status}
          hint={
            to ? STATUS_HINT[to] : next.length ? "Leave as is to change only the assignment." : ""
          }
        >
          <select
            id={ids.status}
            className={FIELD}
            value={to}
            disabled={next.length === 0}
            onChange={(e) => setTo(e.target.value as "" | LeadStatus)}
          >
            <option value="">
              {next.length ? `Keep ${STATUS_LABEL[status]}` : `${STATUS_LABEL[status]} (final)`}
            </option>
            {next.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Assigned to"
          htmlFor={ids.assignee}
          hint="Only staff who work leads of this site are listed."
        >
          <div className="flex gap-2">
            <select
              id={ids.assignee}
              className={cx(FIELD, "min-w-0 flex-1")}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {!knownCurrent && assignedToId ? (
                <option value={assignedToId} disabled>
                  Current assignee (no longer has access)
                </option>
              ) : null}
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.id === viewerId ? " (me)" : ""}
                </option>
              ))}
            </select>
            {assignees.some((a) => a.id === viewerId) && assignee !== viewerId ? (
              <button type="button" className={buttonStyles.secondary} onClick={assignToMe}>
                Me
              </button>
            ) : null}
          </div>
        </Field>
      </div>
      <Field label="Note with this change (optional)" htmlFor={ids.note}>
        <textarea
          id={ids.note}
          className={cx(TEXTAREA, "min-h-20")}
          maxLength={LEAD_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why the status changes, what was agreed…"
        />
      </Field>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <button type="submit" className={buttonStyles.primary} disabled={busy || !dirty}>
        {busy ? <Spinner size={14} /> : null}
        Save change
      </button>
    </form>
  );
}

export function LeadActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const ids = { body: useId(), channel: useId(), when: useId() };
  const [kind, setKind] = useState<"NOTE" | "CONTACT">("NOTE");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<LeadContactChannel>("PHONE");
  const [when, setWhen] = useState(() => nowLocalDateTime());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    let contactedAt: string | null = null;
    if (kind === "CONTACT") {
      contactedAt = localDateTimeToIso(when);
      if (!contactedAt) {
        setMessage({ kind: "error", text: "Enter when the contact took place." });
        return;
      }
    }
    setBusy(true);
    setMessage(null);
    const res = await addLeadActivity(
      leadId,
      kind === "NOTE"
        ? { kind, body }
        : { kind, body, channel, contactedAt: contactedAt as string },
    );
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    setBody("");
    setWhen(nowLocalDateTime());
    setMessage({ kind: "success", text: kind === "NOTE" ? "Note added." : "Contact recorded." });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Add a note or record a contact">
      <div
        role="radiogroup"
        aria-label="Entry type"
        className="inline-flex rounded-lg border border-line-strong bg-surface-2 p-0.5"
      >
        {(["NOTE", "CONTACT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              "h-8 rounded-md px-3 text-sm font-medium transition-colors",
              kind === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
            )}
          >
            {k === "NOTE" ? "Note" : "Contact"}
          </button>
        ))}
      </div>
      {kind === "CONTACT" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Channel" htmlFor={ids.channel}>
            <select
              id={ids.channel}
              className={FIELD}
              value={channel}
              onChange={(e) => setChannel(e.target.value as LeadContactChannel)}
            >
              {LEAD_CONTACT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="When" htmlFor={ids.when}>
            <input
              id={ids.when}
              type="datetime-local"
              className={FIELD}
              value={when}
              max={nowLocalDateTime()}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </Field>
        </div>
      ) : null}
      <Field
        label={kind === "NOTE" ? "Note" : "Summary"}
        htmlFor={ids.body}
        hint="Visible to staff who read this site's leads. Cleared when the lead is anonymised."
      >
        <textarea
          id={ids.body}
          className={TEXTAREA}
          required
          maxLength={LEAD_NOTE_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            kind === "NOTE" ? "What the team should know…" : "What was discussed, next steps…"
          }
        />
      </Field>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <button type="submit" className={buttonStyles.primary} disabled={busy || !body.trim()}>
        {busy ? <Spinner size={14} /> : null}
        {kind === "NOTE" ? "Add note" : "Record contact"}
      </button>
    </form>
  );
}
