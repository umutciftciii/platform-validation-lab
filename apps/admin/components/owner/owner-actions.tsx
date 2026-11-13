"use client";
/**
 * Interactive parts of the system owner console (DP-110, ADR-018): module switches with a reason,
 * chain verification, the protected audit trail and the one-time designation confirmation. Each
 * sensitive call may answer "step-up required"; the component then asks for an authenticator code
 * and retries once. The API decides everything (404 for anyone but the owner).
 */
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type {
  OwnerChainStatus,
  OwnerModule,
  OwnerSite,
  ProtectedAuditEvent,
} from "@dream/contracts";
import {
  changeModule,
  confirmDesignation,
  protectedAudit,
  verifyChain,
} from "../../lib/owner-client";
import { stepUp, type StaffCall } from "../../lib/staff-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Amsterdam",
});

// --- step-up ----------------------------------------------------------------------------------

/**
 * Runs a sensitive call; when the API wants a fresh MFA step-up it shows a code field, verifies
 * the code and runs the call again.
 */
function useStepUp() {
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  async function run<T>(
    call: () => Promise<StaffCall<T>>,
    done: (res: StaffCall<T>) => void,
  ): Promise<void> {
    const res = await call();
    if (!res.ok && res.stepUp) {
      setPending(() => async () => done(await call()));
      return;
    }
    done(res);
  }
  return { pending, clear: () => setPending(null), run };
}

function StepUpPrompt({ retry, onCancel }: { retry: () => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const up = await stepUp(code.replace(/\s/g, ""));
    if (!up.ok) {
      setBusy(false);
      setError(up.message);
      return;
    }
    await retry();
    setBusy(false);
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
      aria-label="Confirm with your authenticator"
    >
      <Field
        label="Authenticator code"
        htmlFor={id}
        hint="This change needs a fresh confirmation from your authenticator app."
      >
        <input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className={FIELD}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonStyles.primary} disabled={busy || !code.trim()}>
          {busy ? <Spinner size={14} /> : null}
          Confirm
        </button>
        <button type="button" className={buttonStyles.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- module switches ----------------------------------------------------------------------

export function ModuleSwitch({
  module,
  site,
  enabled,
}: {
  module: Pick<OwnerModule, "key" | "name" | "isCore">;
  site: OwnerSite;
  enabled: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const step = useStepUp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  if (module.isCore) {
    return <StatusPill tone="success">Always on</StatusPill>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    await step.run(
      () => changeModule(module.key, site.id, !enabled, reason.trim()),
      (res) => {
        setBusy(false);
        step.clear();
        if (!res.ok) {
          setMessage({ kind: "error", text: res.message });
          return;
        }
        setOpen(false);
        setReason("");
        router.refresh();
      },
    );
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</StatusPill>
        {open ? null : (
          <button
            type="button"
            className={buttonStyles.ghost}
            onClick={() => setOpen(true)}
            aria-label={`${enabled ? "Switch off" : "Switch on"} ${module.name} on ${site.name}`}
          >
            {enabled ? "Switch off" : "Switch on"}
          </button>
        )}
      </div>
      {open ? (
        <form onSubmit={submit} className="space-y-2" aria-label={`Change ${module.name}`}>
          <Field
            label="Reason"
            htmlFor={id}
            hint={
              enabled
                ? "Switching off keeps all data; the module's functions stop for everyone."
                : "Recorded in the protected audit trail."
            }
          >
            <input
              id={id}
              required
              minLength={3}
              maxLength={1000}
              className={FIELD}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? <Spinner size={14} /> : null}
              {enabled ? "Switch off" : "Switch on"}
            </button>
            <button
              type="button"
              className={buttonStyles.ghost}
              onClick={() => {
                setOpen(false);
                setMessage(null);
                step.clear();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {step.pending ? <StepUpPrompt retry={step.pending} onCancel={step.clear} /> : null}
    </div>
  );
}

// --- chain verification -------------------------------------------------------------------

export function ChainStatus({ initial }: { initial: OwnerChainStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = useStepUp();
  async function verify() {
    setBusy(true);
    setError(null);
    await step.run(verifyChain, (res) => {
      step.clear();
      if (res.ok) setStatus(res.data);
      else setError(res.message);
    });
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <Fact label="State">
          {status.intact ? (
            <StatusPill tone="success">Intact</StatusPill>
          ) : (
            <StatusPill tone="danger">Broken at #{status.firstBrokenSeq}</StatusPill>
          )}
        </Fact>
        <Fact label="Protected events">{status.events}</Fact>
        <Fact label="Checked">{DATE_TIME.format(new Date(status.checkedAt))}</Fact>
        <div className="sm:col-span-3">
          <dt className="text-ink-3">Head hash (#{status.headSeq})</dt>
          <dd className="break-all font-mono text-xs text-ink-2">{status.headHash ?? "—"}</dd>
        </div>
      </dl>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <button type="button" className={buttonStyles.secondary} onClick={verify} disabled={busy}>
        {busy ? <Spinner size={14} /> : null}
        Verify now
      </button>
      {step.pending ? <StepUpPrompt retry={step.pending} onCancel={step.clear} /> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{children}</dd>
    </div>
  );
}

// --- protected audit trail ----------------------------------------------------------------

const OUTCOME_TONE = { SUCCESS: "success", DENIED: "danger", FAILURE: "amber" } as const;

export function ProtectedAuditLog() {
  const [items, setItems] = useState<ProtectedAuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = useStepUp();

  async function load(before?: number) {
    setBusy(true);
    setError(null);
    await step.run(
      () => protectedAudit(before),
      (res) => {
        step.clear();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setItems((cur) => (before ? [...cur, ...res.data.items] : res.data.items));
        setNext(res.data.nextBefore);
        setLoaded(true);
      },
    );
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {step.pending ? <StepUpPrompt retry={step.pending} onCancel={step.clear} /> : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {loaded && !items.length ? (
        <p className="text-sm text-ink-3">No protected events yet.</p>
      ) : null}
      {items.length ? (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {items.map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[5rem_1fr_auto]">
              <span className="font-mono text-xs text-ink-3">#{e.chainSeq}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{e.action}</span>
                  <StatusPill tone={OUTCOME_TONE[e.outcome]}>{e.outcome.toLowerCase()}</StatusPill>
                </p>
                <p className="truncate text-ink-3">
                  {e.actorLabel ?? e.actorType.toLowerCase()} · {e.resourceType}
                  {e.resourceId ? ` ${e.resourceId}` : ""}
                  {e.reason ? ` · ${e.reason}` : ""}
                </p>
              </div>
              <time className="text-xs text-ink-3" dateTime={e.occurredAt}>
                {DATE_TIME.format(new Date(e.occurredAt))}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!loaded && !step.pending ? (
          <button
            type="button"
            className={buttonStyles.secondary}
            onClick={() => load()}
            disabled={busy}
          >
            {busy ? <Spinner size={14} /> : null}
            Load protected events
          </button>
        ) : null}
        {next ? (
          <button
            type="button"
            className={buttonStyles.secondary}
            onClick={() => load(next)}
            disabled={busy}
          >
            {busy ? <Spinner size={14} /> : null}
            Older events
          </button>
        ) : null}
      </div>
    </div>
  );
}

// --- designation confirmation -------------------------------------------------------------

const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/** The token in the link's fragment (`#t=…`); null while rendering on the server. */
function useFragmentToken(): string | null {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null,
  );
  if (hash === null) return null;
  return /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash)?.[1] ?? "";
}

export function ConfirmDesignation() {
  const router = useRouter();
  const token = useFragmentToken();
  const id = useId();
  const step = useStepUp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // After a successful confirmation the spent token is taken out of the address bar, so the
  // next render reads an empty fragment: the outcome has to win over the "no link" message.
  if (message?.kind === "success") {
    return (
      <div className="max-w-md">
        <FormMessage kind="success">{message.text}</FormMessage>
      </div>
    );
  }
  if (token === null) return <Spinner />;
  if (!token) {
    return (
      <FormMessage kind="error">
        This page needs the confirmation link from the operator. Open the full link again.
      </FormMessage>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setMessage(null);
    await step.run(
      () => confirmDesignation(token, password),
      (res) => {
        step.clear();
        if (!res.ok) {
          setMessage({ kind: "error", text: res.message });
          return;
        }
        setPassword("");
        // The single-use token is spent; take it out of the address bar.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setMessage({
          kind: "success",
          text: "You are now the system owner. The owner console is in the navigation.",
        });
        router.refresh();
      },
    );
    setBusy(false);
  }
  return (
    <div className="max-w-md space-y-4">
      <form onSubmit={submit} className="space-y-4" aria-label="Confirm the owner designation">
        <Field
          label="Your current password"
          htmlFor={id}
          hint="Confirms that this account belongs to you. The designation cannot be undone or handed on."
        >
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            required
            className={FIELD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
        <button type="submit" className={cx(buttonStyles.primary)} disabled={busy || !password}>
          {busy ? <Spinner size={14} /> : null}
          Confirm designation
        </button>
      </form>
      {step.pending ? <StepUpPrompt retry={step.pending} onCancel={step.clear} /> : null}
    </div>
  );
}
