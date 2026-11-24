"use client";
/**
 * Interactive parts of the system owner console (DP-110, ADR-018): module switches with a reason,
 * chain verification, the protected audit trail and the one-time designation confirmation. Each
 * sensitive call may answer "step-up required"; the component then asks for an authenticator code
 * and retries once. The API decides everything (404 for anyone but the owner).
 *
 * ML-12e (DP-243): texts in the admin UI language; audit event codes, resource types, hashes,
 * chain numbers and the API's module keys are shown unchanged.
 */
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type {
  OwnerChainStatus,
  OwnerModule,
  OwnerSite,
  ProtectedAuditEvent,
} from "@dream/contracts";
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import {
  changeModule,
  confirmDesignation,
  ownerModuleName,
  protectedAudit,
  verifyChain,
} from "../../lib/owner-client";
import { stepUp, type StaffCall } from "../../lib/staff-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

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

function StepUpPrompt({
  retry,
  onCancel,
  variant = "inline",
}: {
  retry: () => Promise<void>;
  onCancel: () => void;
  /** DP-268: "dialog" = the second step inside the module switch dialog. */
  variant?: "inline" | "dialog";
}) {
  const t = useT();
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
  if (variant === "dialog") {
    return (
      <DialogForm onSubmit={submit} label={t("owner.stepUp.form")}>
        <DialogBody>
          <Field label={t("owner.stepUp.code")} htmlFor={id} hint={t("owner.stepUp.hint")}>
            <input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              className={FIELD}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        </DialogBody>
        <DialogFooter>
          <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
            {t("owner.stepUp.cancel")}
          </button>
          <button type="submit" className={buttonStyles.primary} disabled={busy || !code.trim()}>
            {busy ? <Spinner size={14} /> : null}
            <span>{t("owner.stepUp.confirm")}</span>
          </button>
        </DialogFooter>
      </DialogForm>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
      aria-label={t("owner.stepUp.form")}
    >
      <Field label={t("owner.stepUp.code")} htmlFor={id} hint={t("owner.stepUp.hint")}>
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
          <span>{t("owner.stepUp.confirm")}</span>
        </button>
        <button type="button" className={buttonStyles.ghost} onClick={onCancel}>
          {t("owner.stepUp.cancel")}
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
  const t = useT();
  const id = useId();
  const step = useStepUp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  if (module.isCore) {
    return <StatusPill tone="success">{t("owner.switch.alwaysOn")}</StatusPill>;
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

  const name = ownerModuleName(module, t);
  const label = t(enabled ? "owner.switch.switchOffLabel" : "owner.switch.switchOnLabel", {
    module: name,
    site: site.name,
  });
  function cancel() {
    setOpen(false);
    setMessage(null);
    step.clear();
  }
  // DP-268: the reason form opens as the console's modal; the switch button stays on the page and
  // gets focus back. A step-up is the dialog's second step. Cancel keeps the typed reason (as
  // before), so Escape has nothing to discard.
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={enabled ? "success" : "neutral"}>
          {enabled ? t("owner.switch.on") : t("owner.switch.off")}
        </StatusPill>
        <button
          type="button"
          className={buttonStyles.ghost}
          onClick={() => setOpen(true)}
          aria-label={label}
          aria-haspopup="dialog"
        >
          {enabled ? t("owner.switch.switchOff") : t("owner.switch.switchOn")}
        </button>
      </div>
      {open || step.pending ? (
        <Dialog title={label} size="md" busy={busy} onClose={cancel}>
          {step.pending ? (
            <StepUpPrompt variant="dialog" retry={step.pending} onCancel={step.clear} />
          ) : (
            <DialogForm onSubmit={submit} label={t("owner.switch.form", { module: name })}>
              <DialogBody>
                <Field
                  label={t("owner.switch.reason")}
                  htmlFor={id}
                  hint={enabled ? t("owner.switch.hintOff") : t("owner.switch.hintOn")}
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
              </DialogBody>
              <DialogFooter>
                <button type="button" className={buttonStyles.secondary} onClick={cancel}>
                  {t("owner.switch.cancel")}
                </button>
                <button
                  type="submit"
                  className={enabled ? buttonStyles.danger : buttonStyles.primary}
                  disabled={busy || reason.trim().length < 3}
                >
                  {busy ? <Spinner size={14} /> : null}
                  <span>{enabled ? t("owner.switch.switchOff") : t("owner.switch.switchOn")}</span>
                </button>
              </DialogFooter>
            </DialogForm>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}

// --- chain verification -------------------------------------------------------------------

export function ChainStatus({ initial }: { initial: OwnerChainStatus }) {
  const t = useT();
  const locale = useAdminLocale();
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
        <Fact label={t("owner.chain.state")}>
          {status.intact ? (
            <StatusPill key="intact" tone="success">
              {t("owner.chain.intact")}
            </StatusPill>
          ) : (
            <StatusPill key="broken" tone="danger">
              {t("owner.chain.broken", { seq: status.firstBrokenSeq ?? "" })}
            </StatusPill>
          )}
        </Fact>
        <Fact label={t("owner.chain.events")}>{status.events}</Fact>
        <Fact label={t("owner.chain.checked")}>
          {dateTimeFormat(locale, DATE_TIME).format(new Date(status.checkedAt))}
        </Fact>
        <div className="sm:col-span-3">
          <dt className="text-ink-3">{t("owner.chain.headHash", { seq: status.headSeq })}</dt>
          <dd className="break-all font-mono text-xs text-ink-2">{status.headHash ?? "—"}</dd>
        </div>
      </dl>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <button type="button" className={buttonStyles.secondary} onClick={verify} disabled={busy}>
        {busy ? <Spinner size={14} /> : null}
        <span>{t("owner.chain.verify")}</span>
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
  const t = useT();
  const locale = useAdminLocale();
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
        <p className="text-sm text-ink-3">{t("owner.audit.empty")}</p>
      ) : null}
      {items.length ? (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {items.map((e) => (
            <li key={e.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[5rem_1fr_auto]">
              <span className="font-mono text-xs text-ink-3">#{e.chainSeq}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{e.action}</span>
                  <StatusPill tone={OUTCOME_TONE[e.outcome]}>
                    {t(`owner.audit.outcome.${e.outcome}`)}
                  </StatusPill>
                </p>
                <p className="truncate text-ink-3">
                  {e.actorLabel ?? t(`owner.audit.actor.${e.actorType}`)} · {e.resourceType}
                  {e.resourceId ? ` ${e.resourceId}` : ""}
                  {e.reason ? ` · ${e.reason}` : ""}
                </p>
              </div>
              <time className="text-xs text-ink-3" dateTime={e.occurredAt}>
                {dateTimeFormat(locale, DATE_TIME).format(new Date(e.occurredAt))}
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
            <span>{t("owner.audit.load")}</span>
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
            <span>{t("owner.audit.older")}</span>
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
  const t = useT();
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
    return <FormMessage kind="error">{t("owner.confirm.noLink")}</FormMessage>;
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
          text: t("owner.confirm.success"),
        });
        router.refresh();
      },
    );
    setBusy(false);
  }
  return (
    <div className="max-w-md space-y-4">
      <form onSubmit={submit} className="space-y-4" aria-label={t("owner.confirm.form")}>
        <Field
          label={t("owner.confirm.password")}
          htmlFor={id}
          hint={t("owner.confirm.passwordHint")}
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
          <span>{t("owner.confirm.submit")}</span>
        </button>
      </form>
      {step.pending ? <StepUpPrompt retry={step.pending} onCancel={step.clear} /> : null}
    </div>
  );
}
