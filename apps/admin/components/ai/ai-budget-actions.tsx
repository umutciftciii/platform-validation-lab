"use client";
/**
 * DP-293 (ADR-030 D6, D7): the changes of the AI Center's budget and reporting screens — create
 * and edit a budget, the engine settings, a provider's own daily figure, a new dated price. Each is
 * a management call (ai_budget:manage / ai_model:manage) that asks for a fresh MFA step-up.
 *
 * Shown only to those who may make the change; the browser checks here are conveniences, never a
 * safeguard: the database enforces every limit (DP-290) and the API decides again on every call.
 * Amounts are typed in USD and sent as exact micro-USD strings (no float).
 */
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { AiBudget, AiProviderKey, AiSettingsDto, AiOverviewResponse } from "@dream/contracts";
import { AI_PROVIDERS } from "@dream/contracts";
import {
  createBudget,
  recordProviderFigure,
  updateBudget,
  updateSettings,
} from "../../lib/ai-client";
import { PROVIDER_NAMES, microsToUsd, usdToMicros } from "../../lib/ai-view";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, Spinner } from "../ui";
import { PriceDialog, useChange } from "./ai-actions";

type Change = ReturnType<typeof useChange>;
type Site = AiOverviewResponse["sites"][number];

function Footer({
  change,
  onClose,
  save,
  hint,
}: {
  change: Change;
  onClose: () => void;
  save: string;
  hint?: string;
}) {
  const t = useT();
  return (
    <DialogFooter hint={hint}>
      <button
        type="button"
        className={buttonStyles.secondary}
        onClick={onClose}
        disabled={change.busy}
      >
        {t("ai.common.cancel")}
      </button>
      <button type="submit" className={buttonStyles.primary} disabled={change.busy}>
        {change.busy ? <Spinner size={14} /> : null}
        <span>{save}</span>
      </button>
    </DialogFooter>
  );
}

function Messages({ invalid, change }: { invalid: string | null; change: Change }) {
  return (
    <>
      {invalid ? (
        <div className="mt-3">
          <FormMessage kind="error">{invalid}</FormMessage>
        </div>
      ) : null}
      {change.error ? (
        <div className="mt-3">
          <FormMessage kind="error">{change.error}</FormMessage>
        </div>
      ) : null}
    </>
  );
}

function Shell({
  title,
  text,
  change,
  onClose,
  children,
}: {
  title: string;
  text: ReactNode;
  change: Change;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog
      title={title}
      description={<p>{text}</p>}
      size="md"
      busy={change.busy}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? change.stepUp("dialog") : children}
    </Dialog>
  );
}

const pctOk = (v: string) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100;

// --- budgets -------------------------------------------------------------------------------------

/** "Edit" of one budget: limit, warning threshold, active. */
export function EditBudgetButton({ budget, label }: { budget: AiBudget; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t("ai.budgets.edit")}
        <span className="sr-only">: {label}</span>
      </button>
      {open ? (
        <EditBudgetDialog budget={budget} label={label} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function EditBudgetDialog({
  budget: b,
  label,
  onClose,
}: {
  budget: AiBudget;
  label: string;
  onClose: () => void;
}) {
  const t = useT();
  const ids = { limit: useId(), warn: useId(), active: useId() };
  const change = useChange();
  const [limit, setLimit] = useState(microsToUsd(b.limitMicros));
  const [warn, setWarn] = useState(String(b.warnPct));
  const [active, setActive] = useState(b.active);
  const [invalid, setInvalid] = useState<string | null>(null);
  const title = t("ai.budgets.editTitle", { budget: label });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const micros = usdToMicros(limit);
    if (micros === null || BigInt(micros) <= 0n || !pctOk(warn)) {
      setInvalid(t("ai.budgets.invalid"));
      return;
    }
    setInvalid(null);
    const ok = await change.run(() =>
      updateBudget(b.id, {
        limitMicros: micros,
        warnPct: Number(warn),
        active,
        version: b.version,
      }),
    );
    if (ok) onClose();
  }
  return (
    <Shell title={title} text={t("ai.budgets.editText")} change={change} onClose={onClose}>
      <DialogForm onSubmit={submit} label={title}>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("ai.budgets.limitField")}
              htmlFor={ids.limit}
              hint={t("ai.budgets.limitHint")}
            >
              <input
                id={ids.limit}
                required
                inputMode="decimal"
                className={FIELD}
                value={limit}
                aria-invalid={invalid ? true : undefined}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <Field
              label={t("ai.budgets.warnField")}
              htmlFor={ids.warn}
              hint={t("ai.budgets.warnHint")}
            >
              <input
                id={ids.warn}
                required
                inputMode="numeric"
                className={FIELD}
                value={warn}
                aria-invalid={invalid ? true : undefined}
                onChange={(e) => setWarn(e.target.value)}
              />
            </Field>
          </div>
          <label htmlFor={ids.active} className="mt-4 flex items-start gap-2 text-sm text-ink">
            <input
              id={ids.active}
              type="checkbox"
              className="mt-0.5 size-4 accent-petrol"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>{t("ai.budgets.activeField")}</span>
          </label>
          {!active && b.active ? (
            <p className="mt-2 text-sm text-ink-2">{t("ai.budgets.deactivateNote")}</p>
          ) : null}
          <Messages invalid={invalid} change={change} />
        </DialogBody>
        <Footer
          change={change}
          onClose={onClose}
          save={t("ai.common.save")}
          hint={t("ai.budgets.enforced")}
        />
      </DialogForm>
    </Shell>
  );
}

/** "New budget": platform or one site, daily or monthly. */
export function NewBudgetButton({ sites }: { sites: readonly Site[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.primary} onClick={() => setOpen(true)}>
        {t("ai.budgets.add")}
      </button>
      {open ? <NewBudgetDialog sites={sites} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewBudgetDialog({ sites, onClose }: { sites: readonly Site[]; onClose: () => void }) {
  const t = useT();
  const ids = { scope: useId(), period: useId(), limit: useId(), warn: useId() };
  const change = useChange();
  const [scope, setScope] = useState<string>("PLATFORM");
  const [period, setPeriod] = useState<"DAILY" | "MONTHLY">("DAILY");
  const [limit, setLimit] = useState("");
  const [warn, setWarn] = useState("80");
  const [invalid, setInvalid] = useState<string | null>(null);
  const title = t("ai.budgets.addTitle");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const micros = usdToMicros(limit);
    if (micros === null || BigInt(micros) <= 0n || !pctOk(warn)) {
      setInvalid(t("ai.budgets.invalid"));
      return;
    }
    setInvalid(null);
    const site = scope === "PLATFORM" ? null : scope;
    const ok = await change.run(() =>
      createBudget({
        scope: site ? "SITE" : "PLATFORM",
        ...(site ? { siteId: site } : {}),
        period,
        limitMicros: micros,
        warnPct: Number(warn),
      }),
    );
    if (ok) onClose();
  }
  return (
    <Shell title={title} text={t("ai.budgets.addText")} change={change} onClose={onClose}>
      <DialogForm onSubmit={submit} label={title}>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("ai.budgets.scopeField")} htmlFor={ids.scope}>
              <select
                id={ids.scope}
                className={FIELD}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="PLATFORM">{t("ai.budgets.scope.PLATFORM")}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t("ai.budgets.siteScope", { site: s.name })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("ai.budgets.periodField")} htmlFor={ids.period}>
              <select
                id={ids.period}
                className={FIELD}
                value={period}
                onChange={(e) => setPeriod(e.target.value as "DAILY" | "MONTHLY")}
              >
                <option value="DAILY">{t("ai.budgets.period.DAILY")}</option>
                <option value="MONTHLY">{t("ai.budgets.period.MONTHLY")}</option>
              </select>
            </Field>
            <Field
              label={t("ai.budgets.limitField")}
              htmlFor={ids.limit}
              hint={t("ai.budgets.limitHint")}
            >
              <input
                id={ids.limit}
                required
                inputMode="decimal"
                className={FIELD}
                value={limit}
                aria-invalid={invalid ? true : undefined}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <Field
              label={t("ai.budgets.warnField")}
              htmlFor={ids.warn}
              hint={t("ai.budgets.warnHint")}
            >
              <input
                id={ids.warn}
                required
                inputMode="numeric"
                className={FIELD}
                value={warn}
                onChange={(e) => setWarn(e.target.value)}
              />
            </Field>
          </div>
          <p className="mt-3 text-sm text-ink-2">{t("ai.budgets.utcNote")}</p>
          <Messages invalid={invalid} change={change} />
        </DialogBody>
        <Footer
          change={change}
          onClose={onClose}
          save={t("ai.budgets.create")}
          hint={t("ai.budgets.enforced")}
        />
      </DialogForm>
    </Shell>
  );
}

// --- engine settings -----------------------------------------------------------------------------

export function SettingsButton({ settings }: { settings: AiSettingsDto }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t("ai.engine.edit")}
      </button>
      {open ? <SettingsDialog settings={settings} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SettingsDialog({
  settings: s,
  onClose,
}: {
  settings: AiSettingsDto;
  onClose: () => void;
}) {
  const t = useT();
  const ids = { c: useId(), ttl: useId(), margin: useId() };
  const change = useChange();
  const [v, setV] = useState({
    c: String(s.maxConcurrency),
    ttl: String(s.reservationTtlSec),
    margin: String(s.safetyMarginPct),
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const title = t("ai.engine.title");
  const int = (x: string, min: number, max: number) =>
    /^\d{1,5}$/.test(x) && Number(x) >= min && Number(x) <= max ? Number(x) : null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = int(v.c, 1, 20);
    const ttl = int(v.ttl, 30, 3600);
    const margin = int(v.margin, 0, 100);
    if (c === null || ttl === null || margin === null) {
      setInvalid(t("ai.engine.invalid"));
      return;
    }
    setInvalid(null);
    const ok = await change.run(() =>
      updateSettings({
        maxConcurrency: c,
        reservationTtlSec: ttl,
        safetyMarginPct: margin,
        version: s.version,
      }),
    );
    if (ok) onClose();
  }
  const field = (key: keyof typeof v, label: string, hint: string) => (
    <Field label={label} htmlFor={ids[key]} hint={hint}>
      <input
        id={ids[key]}
        required
        inputMode="numeric"
        className={FIELD}
        value={v[key]}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Shell title={title} text={t("ai.engine.text")} change={change} onClose={onClose}>
      <DialogForm onSubmit={submit} label={title}>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-3">
            {field("c", t("ai.engine.concurrency"), t("ai.engine.concurrencyHint"))}
            {field("ttl", t("ai.engine.ttl"), t("ai.engine.ttlHint"))}
            {field("margin", t("ai.engine.margin"), t("ai.engine.marginHint"))}
          </div>
          <Messages invalid={invalid} change={change} />
        </DialogBody>
        <Footer change={change} onClose={onClose} save={t("ai.common.save")} />
      </DialogForm>
    </Shell>
  );
}

// --- reconciliation ------------------------------------------------------------------------------

export function RecordFigureButton({ today }: { today: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.primary} onClick={() => setOpen(true)}>
        {t("ai.reconciliation.record")}
      </button>
      {open ? <RecordFigureDialog today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RecordFigureDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const t = useT();
  const ids = { provider: useId(), day: useId(), amount: useId(), project: useId(), note: useId() };
  const change = useChange();
  const [v, setV] = useState({
    provider: "OPENAI" as AiProviderKey,
    day: today,
    amount: "",
    project: "",
    note: "",
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const title = t("ai.reconciliation.recordTitle");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const micros = usdToMicros(v.amount);
    if (micros === null || !/^\d{4}-\d{2}-\d{2}$/.test(v.day) || v.day > today) {
      setInvalid(t("ai.reconciliation.invalid"));
      return;
    }
    setInvalid(null);
    const ok = await change.run(() =>
      recordProviderFigure({
        provider: v.provider,
        day: v.day,
        providerAmountMicros: micros,
        ...(v.project.trim() ? { projectRef: v.project.trim() } : {}),
        ...(v.note.trim() ? { note: v.note.trim() } : {}),
      }),
    );
    if (ok) onClose();
  }
  return (
    <Shell title={title} text={t("ai.reconciliation.recordText")} change={change} onClose={onClose}>
      <DialogForm onSubmit={submit} label={title}>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("ai.reconciliation.provider")} htmlFor={ids.provider}>
              <select
                id={ids.provider}
                className={FIELD}
                value={v.provider}
                onChange={(e) => setV({ ...v, provider: e.target.value as AiProviderKey })}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_NAMES[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("ai.reconciliation.dayField")}
              htmlFor={ids.day}
              hint={t("ai.reconciliation.dayHint")}
            >
              <input
                id={ids.day}
                type="date"
                required
                max={today}
                className={FIELD}
                value={v.day}
                onChange={(e) => setV({ ...v, day: e.target.value })}
              />
            </Field>
            <Field label={t("ai.reconciliation.amountField")} htmlFor={ids.amount}>
              <input
                id={ids.amount}
                required
                inputMode="decimal"
                className={FIELD}
                value={v.amount}
                aria-invalid={invalid ? true : undefined}
                onChange={(e) => setV({ ...v, amount: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label={t("ai.reconciliation.projectField")}
              htmlFor={ids.project}
              hint={t("ai.reconciliation.projectHint")}
            >
              <input
                id={ids.project}
                maxLength={200}
                className={FIELD}
                value={v.project}
                onChange={(e) => setV({ ...v, project: e.target.value })}
              />
            </Field>
            <Field
              label={t("ai.reconciliation.noteField")}
              htmlFor={ids.note}
              hint={t("ai.reconciliation.noteHint")}
            >
              <input
                id={ids.note}
                maxLength={500}
                className={FIELD}
                value={v.note}
                onChange={(e) => setV({ ...v, note: e.target.value })}
              />
            </Field>
          </div>
          <Messages invalid={invalid} change={change} />
        </DialogBody>
        <Footer
          change={change}
          onClose={onClose}
          save={t("ai.reconciliation.save")}
          hint={t("ai.reconciliation.appendOnly")}
        />
      </DialogForm>
    </Shell>
  );
}

// --- prices --------------------------------------------------------------------------------------

/** "Add price" of a model on the price list (the models tab has the same dialog). */
export function AddPriceButton({ modelId, displayName }: { modelId: string; displayName: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t("ai.prices.add")}
        <span className="sr-only">: {displayName}</span>
      </button>
      {open ? (
        <PriceDialog model={{ id: modelId, displayName }} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
