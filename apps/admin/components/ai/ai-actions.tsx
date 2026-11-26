"use client";
/**
 * DP-292 (ADR-030): the interactive parts of the AI Center — provider keys and settings, models
 * and their prices, task settings. Shown by permission (`AiPermissions` of the overview); the API
 * decides again on every call and asks for a fresh MFA step-up for every change (the dialog then
 * asks for an authenticator code and retries once).
 *
 * An API key is typed once into a password field, sent once in the POST body and never shown,
 * stored or kept in the page: the field is emptied as soon as it is sent; the screen only ever
 * shows the key's hint (provider prefix + last four characters).
 *
 * Switching AI on or off is not here: only the system owner does it, in the Owner Console.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type {
  AiCredentialSummary,
  AiModelSummary,
  AiPermissions,
  AiProviderDataTermsResponse,
  AiPrice,
  AiProviderKey,
  AiProviderResultCode,
  AiProviderSummary,
  AiTaskSettingDto,
} from "@dream/contracts";
import {
  activateCredential,
  addCredential,
  addPrice,
  disableCredential,
  disableModel,
  enableModel,
  refreshModels,
  revokeCredential,
  testCredential,
  updateProvider,
  updateTask,
  verifyModel,
} from "../../lib/ai-client";
import {
  PROVIDER_NAMES,
  activeCredential,
  capability,
  credentialActions,
  microsToUsd,
  modelActions,
  usableModels,
  usdToMicros,
  type CredentialAction,
  type ModelAction,
} from "../../lib/ai-view";
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import type { StaffCall } from "../../lib/staff-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { StepUpPrompt, useStepUp } from "../owner/owner-actions";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill, type PillTone } from "../ui";
import { AiDataTerms } from "./ai-data-terms";

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

export function useDate() {
  const locale = useAdminLocale();
  return (iso: string | null) =>
    iso ? dateTimeFormat(locale, DATE_TIME).format(new Date(iso)) : "—";
}

/** One change: runs the call (with the step-up), refreshes the page on success. */
export function useChange() {
  const router = useRouter();
  const step = useStepUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run<T>(
    call: () => Promise<StaffCall<T>>,
    onOk?: (data: T) => string | null | void,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    let ok = false;
    await step.run(call, (res) => {
      if (res.ok) {
        ok = true;
        const message = onOk?.(res.data);
        if (message) setNotice(message);
        router.refresh();
      } else {
        setError(res.message);
      }
    });
    setBusy(false);
    return ok;
  }
  return {
    busy,
    error,
    notice,
    run,
    clear: () => {
      setError(null);
      setNotice(null);
      step.clear();
    },
    stepUp: step.pending
      ? (variant: "inline" | "dialog" = "inline") => (
          <StepUpPrompt
            variant={variant}
            retry={async () => {
              const retry = step.pending;
              step.clear();
              setBusy(true);
              await retry?.();
              setBusy(false);
            }}
            onCancel={() => step.clear()}
          />
        )
      : null,
  };
}

const CREDENTIAL_TONE: Record<AiCredentialSummary["status"], PillTone> = {
  ACTIVE: "success",
  PENDING_TEST: "amber",
  DISABLED: "neutral",
  REVOKED: "danger",
};
const MODEL_TONE: Record<AiModelSummary["status"], PillTone> = {
  ENABLED: "success",
  VERIFIED: "petrol",
  DISCOVERED: "neutral",
  DISABLED: "neutral",
  UNAVAILABLE: "danger",
};

function ResultCode({ code }: { code: string | null }) {
  const t = useT();
  if (!code) return null;
  const known = [
    "ok",
    "credential_invalid",
    "permission_denied",
    "model_not_found",
    "rate_limited",
    "quota_exceeded",
    "provider_unavailable",
    "timeout",
    "network_error",
    "bad_response",
  ] as const;
  const c = (known as readonly string[]).includes(code) ? (code as AiProviderResultCode) : null;
  return <span>{c ? t(`ai.results.${c}`) : code}</span>;
}

const RESULT_CODES: readonly string[] = [
  "ok",
  "credential_invalid",
  "permission_denied",
  "model_not_found",
  "rate_limited",
  "quota_exceeded",
  "provider_unavailable",
  "timeout",
  "network_error",
  "bad_response",
];
/** A verification's provider result in the UI language (never the provider's own text). */
function verifyResult(code: string | null, t: ReturnType<typeof useT>): string {
  return code && RESULT_CODES.includes(code)
    ? t(`ai.results.${code as AiProviderResultCode}`)
    : (code ?? "");
}

// =============================================================================================
// Providers and keys
// =============================================================================================

export function ProvidersPanel({
  providers,
  models,
  transport,
  can,
  dataTerms,
}: {
  providers: readonly AiProviderSummary[];
  models: readonly AiModelSummary[];
  transport: "off" | "fake" | "live";
  can: AiPermissions;
  /**
   * DP-298 (ADR-031 D6): each provider's data-processing terms (null: could not be loaded; a
   * provider left out shows no terms section).
   */
  dataTerms?: Partial<Record<AiProviderKey, AiProviderDataTermsResponse | null>>;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      {transport === "off" ? (
        <p
          role="note"
          className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30"
        >
          {t("ai.providers.transportOff")}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {providers.map((p) => (
          <ProviderCard
            key={p.provider}
            provider={p}
            models={models.filter((m) => m.provider === p.provider)}
            can={can}
            dataTerms={dataTerms?.[p.provider]}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  models,
  can,
  dataTerms,
}: {
  provider: AiProviderSummary;
  models: readonly AiModelSummary[];
  can: AiPermissions;
  dataTerms?: AiProviderDataTermsResponse | null;
}) {
  const t = useT();
  const date = useDate();
  const [dialog, setDialog] = useState<null | "key" | "settings">(null);
  const active = activeCredential(provider.credentials);
  const name = PROVIDER_NAMES[provider.provider];
  const defaultModel = models.find((m) => m.id === provider.defaultModelId) ?? null;
  const history = provider.credentials.filter((c) => c.status !== "ACTIVE");
  return (
    <section
      aria-labelledby={`ai-provider-${provider.provider}`}
      data-provider={provider.provider}
      className="flex flex-col rounded-2xl border border-line bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 id={`ai-provider-${provider.provider}`} className="text-base font-semibold text-ink">
            {name}
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {defaultModel
              ? t("ai.providers.defaultModel", { model: defaultModel.displayName })
              : t("ai.providers.noDefaultModel")}
          </p>
        </div>
        <StatusPill tone={provider.enabled ? "success" : "neutral"}>
          {provider.enabled ? t("ai.providers.enabled") : t("ai.providers.disabled")}
        </StatusPill>
      </header>
      <div className="flex-1 space-y-4 px-5 py-4 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t("ai.providers.activeKey")}
          </p>
          {active ? (
            <CredentialRow credential={active} can={can} />
          ) : (
            <p className="mt-1 text-ink-2">{t("ai.providers.noActiveKey")}</p>
          )}
        </div>
        {history.length > 0 ? (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-ink-2 hover:text-ink">
              {t("ai.providers.otherKeys", { count: history.length })}
            </summary>
            <ul className="mt-2 space-y-3">
              {history.map((c) => (
                <li key={c.id}>
                  <CredentialRow credential={c} can={can} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="text-xs text-ink-3">
          {t("ai.providers.models", {
            enabled: usableModels(models).length,
            total: models.length,
          })}
        </p>
        {active ? (
          <p className="text-xs text-ink-3">
            {t("ai.providers.lastTest", { date: date(active.lastTestedAt) })}
          </p>
        ) : null}
        {dataTerms !== undefined ? (
          <AiDataTerms key="data-terms" provider={provider.provider} terms={dataTerms} />
        ) : null}
      </div>
      {can.providerManage ? (
        <footer className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          <button type="button" className={buttonStyles.secondary} onClick={() => setDialog("key")}>
            {active ? t("ai.providers.replaceKey") : t("ai.providers.addKey")}
          </button>
          <button
            type="button"
            className={buttonStyles.ghost}
            onClick={() => setDialog("settings")}
          >
            {t("ai.providers.settings")}
          </button>
        </footer>
      ) : null}
      {dialog === "key" ? (
        <AddKeyDialog
          provider={provider.provider}
          replacing={active !== null}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "settings" ? (
        <ProviderSettingsDialog
          provider={provider}
          models={models}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}

function CredentialRow({
  credential: c,
  can,
}: {
  credential: AiCredentialSummary;
  can: AiPermissions;
}) {
  const t = useT();
  const date = useDate();
  const change = useChange();
  const [confirm, setConfirm] = useState<null | "disable" | "revoke">(null);
  const actions = credentialActions(c, can);
  const label: Record<CredentialAction, string> = {
    test: t("ai.keys.test"),
    activate: t("ai.keys.activate"),
    disable: t("ai.keys.disable"),
    revoke: t("ai.keys.revoke"),
  };
  async function act(a: CredentialAction) {
    if (a === "test") {
      await change.run(
        () => testCredential(c.id),
        (r) =>
          r.test.code === "ok"
            ? t("ai.keys.testOk", { count: r.test.models })
            : t("ai.keys.testFailed", { result: t(`ai.results.${r.test.code}`) }),
      );
    } else if (a === "activate") {
      await change.run(
        () => activateCredential(c.id),
        () => t("ai.keys.activated"),
      );
    } else {
      setConfirm(a);
    }
  }
  return (
    <div className="mt-1 space-y-2" data-credential={c.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{c.label}</span>
        <code
          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2"
          aria-label={t("ai.keys.hint")}
        >
          {c.keyHint}
        </code>
        <StatusPill tone={CREDENTIAL_TONE[c.status]}>{t(`ai.keys.status.${c.status}`)}</StatusPill>
      </div>
      <p className="flex flex-wrap gap-x-2 text-xs text-ink-3">
        <span>{t("ai.keys.added", { date: date(c.createdAt) })}</span>
        {c.lastTestCode ? <ResultCode code={c.lastTestCode} /> : null}
        {c.projectRef ? <span>{c.projectRef}</span> : null}
      </p>
      {actions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={cx(
                buttonStyles.ghost,
                "h-8 px-2.5 text-xs",
                a === "revoke" && "text-danger hover:text-danger",
              )}
              disabled={change.busy}
              onClick={() => void act(a)}
              aria-label={`${label[a]}: ${c.label}`}
            >
              {label[a]}
            </button>
          ))}
          {change.busy ? <Spinner size={14} /> : null}
        </div>
      ) : null}
      {change.notice ? <FormMessage kind="success">{change.notice}</FormMessage> : null}
      {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
      {change.stepUp && !confirm ? change.stepUp() : null}
      {confirm ? (
        change.stepUp ? (
          <Dialog
            title={t("owner.stepUp.form")}
            onClose={() => {
              change.clear();
              setConfirm(null);
            }}
          >
            {change.stepUp("dialog")}
          </Dialog>
        ) : (
          <ConfirmDialog
            title={confirm === "revoke" ? t("ai.keys.revokeTitle") : t("ai.keys.disableTitle")}
            text={confirm === "revoke" ? t("ai.keys.revokeText") : t("ai.keys.disableText")}
            confirmLabel={label[confirm]}
            cancelLabel={t("ai.common.cancel")}
            danger={confirm === "revoke"}
            pending={change.busy}
            error={change.error}
            onCancel={() => {
              change.clear();
              setConfirm(null);
            }}
            onConfirm={async () => {
              const ok = await change.run(() =>
                confirm === "revoke" ? revokeCredential(c.id) : disableCredential(c.id),
              );
              if (ok) setConfirm(null);
            }}
          />
        )
      ) : null}
    </div>
  );
}

const PROJECT_LABEL: Record<
  AiProviderKey,
  "ai.keys.projectOpenai" | "ai.keys.projectAnthropic" | null
> = {
  OPENAI: "ai.keys.projectOpenai",
  ANTHROPIC: "ai.keys.projectAnthropic",
  GEMINI: null,
};

function AddKeyDialog({
  provider,
  replacing,
  onClose,
}: {
  provider: AiProviderKey;
  replacing: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const ids = { label: useId(), key: useId(), project: useId(), activate: useId() };
  const change = useChange();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [project, setProject] = useState("");
  const [activate, setActivate] = useState(true);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // The page refreshes after a save; the dialog keeps the title it opened with.
  const [wasReplacing] = useState(replacing);
  const projectLabel = PROJECT_LABEL[provider];
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      apiKey: apiKey.trim(),
      label: label.trim(),
      ...(projectLabel && project.trim() ? { projectRef: project.trim() } : {}),
      activate,
    };
    // The key leaves the page now: the field is emptied whatever the answer is.
    setApiKey("");
    setResult(null);
    await change.run(
      () => addCredential(provider, body),
      (r) => {
        setResult({
          ok: r.test.code === "ok",
          text:
            r.test.code === "ok"
              ? r.credential.status === "ACTIVE"
                ? t("ai.keys.addedActive", { count: r.test.models })
                : t("ai.keys.addedTested", { count: r.test.models })
              : t("ai.keys.addedFailed", { result: t(`ai.results.${r.test.code}`) }),
        });
      },
    );
  }
  const title = t(wasReplacing ? "ai.keys.replaceTitle" : "ai.keys.addTitle", {
    provider: PROVIDER_NAMES[provider],
  });
  return (
    <Dialog
      title={title}
      description={<p>{t("ai.keys.addText")}</p>}
      size="md"
      busy={change.busy}
      dirty={apiKey.length > 0}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : result ? (
        <>
          <DialogBody>
            <FormMessage kind={result.ok ? "success" : "error"}>{result.text}</FormMessage>
          </DialogBody>
          <DialogFooter>
            <button type="button" className={buttonStyles.primary} onClick={onClose}>
              {t("ai.common.done")}
            </button>
          </DialogFooter>
        </>
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <div className="space-y-4">
              <Field label={t("ai.keys.label")} htmlFor={ids.label} hint={t("ai.keys.labelHint")}>
                <input
                  id={ids.label}
                  required
                  maxLength={100}
                  className={FIELD}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field label={t("ai.keys.apiKey")} htmlFor={ids.key} hint={t("ai.keys.apiKeyHint")}>
                <input
                  id={ids.key}
                  type="password"
                  required
                  minLength={20}
                  maxLength={512}
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore=""
                  data-lpignore="true"
                  className={cx(FIELD, "font-mono")}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
              {projectLabel ? (
                <Field
                  label={t(projectLabel)}
                  htmlFor={ids.project}
                  hint={t("ai.keys.projectHint")}
                >
                  <input
                    id={ids.project}
                    maxLength={200}
                    className={FIELD}
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  />
                </Field>
              ) : null}
              <label htmlFor={ids.activate} className="flex items-start gap-2 text-sm text-ink">
                <input
                  id={ids.activate}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-petrol"
                  checked={activate}
                  onChange={(e) => setActivate(e.target.checked)}
                />
                <span>
                  {wasReplacing ? t("ai.keys.activateReplace") : t("ai.keys.activateNew")}
                </span>
              </label>
              {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
            </div>
          </DialogBody>
          <DialogFooter hint={t("ai.keys.neverShown")}>
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={onClose}
              disabled={change.busy}
            >
              {t("ai.common.cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={change.busy || !apiKey.trim() || !label.trim()}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>{t("ai.keys.saveAndTest")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

function ProviderSettingsDialog({
  provider,
  models,
  onClose,
}: {
  provider: AiProviderSummary;
  models: readonly AiModelSummary[];
  onClose: () => void;
}) {
  const t = useT();
  const ids = { enabled: useId(), model: useId() };
  const change = useChange();
  const [enabled, setEnabled] = useState(provider.enabled);
  const [model, setModel] = useState(provider.defaultModelId ?? "");
  const choices = usableModels(models);
  const title = t("ai.providers.settingsTitle", { provider: PROVIDER_NAMES[provider.provider] });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await change.run(() =>
      updateProvider(provider.provider, {
        enabled,
        defaultModelId: model || null,
        version: provider.version,
      }),
    );
    if (ok) onClose();
  }
  return (
    <Dialog
      title={title}
      size="md"
      busy={change.busy}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <div className="space-y-4">
              <label htmlFor={ids.enabled} className="flex items-start gap-2 text-sm text-ink">
                <input
                  id={ids.enabled}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-petrol"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>{t("ai.providers.enableProvider")}</span>
              </label>
              <Field
                label={t("ai.providers.defaultModelField")}
                htmlFor={ids.model}
                hint={t("ai.providers.defaultModelHint")}
              >
                <select
                  id={ids.model}
                  className={FIELD}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">{t("ai.providers.noModel")}</option>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.modelId})
                    </option>
                  ))}
                </select>
              </Field>
              {choices.length === 0 ? (
                <p className="text-xs text-ink-3">{t("ai.providers.noUsableModel")}</p>
              ) : null}
              {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
            </div>
          </DialogBody>
          <DialogFooter>
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
              <span>{t("ai.common.save")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

// =============================================================================================
// Models and prices
// =============================================================================================

export function ModelsPanel({
  models,
  prices,
  providers,
  can,
}: {
  models: readonly AiModelSummary[];
  /** The price in force (or the next one) per model id. */
  prices: Readonly<Record<string, AiPrice | undefined>>;
  providers: readonly AiProviderKey[];
  can: AiPermissions;
}) {
  const t = useT();
  const filterId = useId();
  const allId = useId();
  const [provider, setProvider] = useState<AiProviderKey | "ALL">("ALL");
  const [showAll, setShowAll] = useState(false);
  const shown = models.filter(
    (m) =>
      (provider === "ALL" || m.provider === provider) &&
      (showAll || m.compatible || m.requiresConfirmation || m.status === "ENABLED"),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("ai.models.provider")} htmlFor={filterId} className="w-full sm:w-64">
          <select
            id={filterId}
            className={FIELD}
            value={provider}
            onChange={(e) => setProvider(e.target.value as AiProviderKey | "ALL")}
          >
            <option value="ALL">{t("ai.models.allProviders")}</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_NAMES[p]}
              </option>
            ))}
          </select>
        </Field>
        <label htmlFor={allId} className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input
            id={allId}
            type="checkbox"
            className="size-4 accent-petrol"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span>{t("ai.models.showIncompatible")}</span>
        </label>
      </div>
      {can.modelManage ? (
        <div className="flex flex-wrap gap-2">
          {(provider === "ALL" ? providers : [provider]).map((p) => (
            <RefreshButton key={p} provider={p} />
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState icon="ai" title={t("ai.models.emptyTitle")}>
          {can.modelManage ? t("ai.models.emptyManage") : t("ai.models.emptyRead")}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {shown.map((m) => (
            <ModelRow key={m.id} model={m} price={prices[m.id]} can={can} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RefreshButton({ provider }: { provider: AiProviderKey }) {
  const t = useT();
  const change = useChange();
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={buttonStyles.secondary}
        disabled={change.busy}
        onClick={() =>
          void change.run(
            () => refreshModels(provider),
            (r) =>
              r.code === "ok"
                ? t("ai.models.refreshed", {
                    added: r.added,
                    updated: r.updated,
                    unavailable: r.unavailable,
                  })
                : t("ai.models.refreshFailed", { result: t(`ai.results.${r.code}`) }),
          )
        }
      >
        {change.busy ? <Spinner size={14} /> : null}
        <span>{t("ai.models.refresh", { provider: PROVIDER_NAMES[provider] })}</span>
      </button>
      {change.notice ? <FormMessage kind="success">{change.notice}</FormMessage> : null}
      {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
      {change.stepUp ? change.stepUp() : null}
    </div>
  );
}

function CapabilityChip({ label, value }: { label: string; value: boolean | null }) {
  const t = useT();
  const c = capability(value);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset",
        c === "yes"
          ? "bg-success-soft text-success ring-success/25"
          : c === "no"
            ? "bg-surface-2 text-ink-3 ring-line"
            : "bg-amber-soft text-amber-ink ring-amber/30",
      )}
    >
      {label}: {t(`ai.models.capability.${c}`)}
    </span>
  );
}

function ModelRow({
  model: m,
  price,
  can,
}: {
  model: AiModelSummary;
  price: AiPrice | undefined;
  can: AiPermissions;
}) {
  const t = useT();
  const date = useDate();
  const change = useChange();
  const [dialog, setDialog] = useState<null | "enable" | "disable" | "price">(null);
  const actions = modelActions(m, can);
  const label: Record<ModelAction, string> = {
    verify: t("ai.models.verify"),
    enable: t("ai.models.enable"),
    disable: t("ai.models.disable"),
  };
  return (
    <li className="space-y-2 px-4 py-4 sm:px-5" data-model={m.modelId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{m.displayName}</span>
        <code className="font-mono text-xs text-ink-3">{m.modelId}</code>
        <StatusPill tone="neutral">{PROVIDER_NAMES[m.provider]}</StatusPill>
        <StatusPill tone={MODEL_TONE[m.status]}>{t(`ai.models.status.${m.status}`)}</StatusPill>
        {m.compatible ? null : (
          <StatusPill tone="amber">
            {m.requiresConfirmation
              ? t("ai.models.needsConfirmation")
              : t("ai.models.incompatible")}
          </StatusPill>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <CapabilityChip label={t("ai.models.text")} value={m.capabilities.textGeneration} />
        <CapabilityChip label={t("ai.models.structured")} value={m.capabilities.structuredOutput} />
        <CapabilityChip label={t("ai.models.thinking")} value={m.capabilities.thinking} />
        {m.capabilities.lifecycle && m.capabilities.lifecycle !== "active" ? (
          <StatusPill tone="amber">
            {t(`ai.models.lifecycle.${m.capabilities.lifecycle}`)}
          </StatusPill>
        ) : null}
      </div>
      <p className="text-xs text-ink-3">
        {m.contextWindow
          ? t("ai.models.context", { tokens: m.contextWindow })
          : t("ai.models.contextUnknown")}
        {m.maxOutputTokens ? ` · ${t("ai.models.maxOutput", { tokens: m.maxOutputTokens })}` : ""}
        {m.lastVerifiedAt ? ` · ${t("ai.models.verified", { date: date(m.lastVerifiedAt) })}` : ""}
      </p>
      <p className="text-xs text-ink-2">
        {price
          ? t("ai.models.price", {
              input: microsToUsd(price.inputMicrosPerMTok),
              output: microsToUsd(price.outputMicrosPerMTok),
              date: date(price.effectiveFrom),
            })
          : t("ai.models.noPrice")}
      </p>
      {m.requiresConfirmation && m.status !== "ENABLED" ? (
        <p className="text-xs text-ink-2">{t("ai.models.confirmationNote")}</p>
      ) : null}
      {actions.length || (can.modelManage && m.compatible) ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={change.busy}
              className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
              aria-label={`${label[a]}: ${m.displayName}`}
              onClick={() => {
                if (a === "verify") {
                  void change.run(
                    () => verifyModel(m.id),
                    (r) =>
                      r.verifyCode === "ok"
                        ? t("ai.models.verifiedOk")
                        : r.verifyCode === "capabilities_unknown"
                          ? t("ai.models.verifiedUnknown")
                          : r.verifyCode === "incompatible"
                            ? t("ai.models.verifiedIncompatible")
                            : t("ai.models.verifyFailed", {
                                result: verifyResult(r.verifyCode, t),
                              }),
                  );
                } else setDialog(a);
              }}
            >
              {label[a]}
            </button>
          ))}
          {can.modelManage && (m.status === "ENABLED" || m.status === "VERIFIED") ? (
            <button
              type="button"
              className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
              onClick={() => setDialog("price")}
              aria-label={`${t("ai.prices.add")}: ${m.displayName}`}
            >
              {t("ai.prices.add")}
            </button>
          ) : null}
          {change.busy ? <Spinner size={14} /> : null}
        </div>
      ) : null}
      {change.notice ? <FormMessage kind="success">{change.notice}</FormMessage> : null}
      {change.error && !dialog ? <FormMessage kind="error">{change.error}</FormMessage> : null}
      {change.stepUp && !dialog ? change.stepUp() : null}
      {dialog === "enable" ? <EnableModelDialog model={m} onClose={() => setDialog(null)} /> : null}
      {dialog === "price" ? <PriceDialog model={m} onClose={() => setDialog(null)} /> : null}
      {dialog === "disable" ? (
        change.stepUp ? (
          <Dialog
            title={t("owner.stepUp.form")}
            onClose={() => {
              change.clear();
              setDialog(null);
            }}
          >
            {change.stepUp("dialog")}
          </Dialog>
        ) : (
          <ConfirmDialog
            title={t("ai.models.disableTitle", { model: m.displayName })}
            text={t("ai.models.disableText")}
            confirmLabel={t("ai.models.disable")}
            cancelLabel={t("ai.common.cancel")}
            pending={change.busy}
            error={change.error}
            onCancel={() => {
              change.clear();
              setDialog(null);
            }}
            onConfirm={async () => {
              if (await change.run(() => disableModel(m.id))) setDialog(null);
            }}
          />
        )
      ) : null}
    </li>
  );
}

function EnableModelDialog({ model: m, onClose }: { model: AiModelSummary; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const change = useChange();
  const [confirmed, setConfirmed] = useState(false);
  const title = t("ai.models.enableTitle", { model: m.displayName });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await change.run(() => enableModel(m.id, m.requiresConfirmation && confirmed))) onClose();
  }
  return (
    <Dialog
      title={title}
      size="md"
      busy={change.busy}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <div className="space-y-3 text-sm">
              <p className="text-ink-2">{t("ai.models.enableText")}</p>
              {m.requiresConfirmation ? (
                <label
                  htmlFor={id}
                  className="flex items-start gap-2 rounded-lg bg-amber-soft p-3 text-amber-ink ring-1 ring-inset ring-amber/30"
                >
                  <input
                    id={id}
                    type="checkbox"
                    required
                    className="mt-0.5 size-4 accent-petrol"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>{t("ai.models.confirmUnknown")}</span>
                </label>
              ) : null}
              {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={onClose}
              disabled={change.busy}
            >
              {t("ai.common.cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={change.busy || (m.requiresConfirmation && !confirmed)}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>{t("ai.models.enable")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

export function PriceDialog({
  model: m,
  onClose,
}: {
  model: Pick<AiModelSummary, "id" | "displayName">;
  onClose: () => void;
}) {
  const t = useT();
  const ids = { input: useId(), cached: useId(), output: useId(), note: useId(), from: useId() };
  const change = useChange();
  const [v, setV] = useState({ input: "", cached: "", output: "", note: "", from: "" });
  const [invalid, setInvalid] = useState(false);
  const title = t("ai.prices.title", { model: m.displayName });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = usdToMicros(v.input);
    const cached = usdToMicros(v.cached || "0");
    const output = usdToMicros(v.output);
    // DP-293: an optional start in the future, typed as UTC ("YYYY-MM-DDTHH:MM").
    const from = v.from ? new Date(`${v.from}:00Z`) : null;
    if (
      input === null ||
      cached === null ||
      output === null ||
      (from !== null && Number.isNaN(from.getTime()))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const ok = await change.run(() =>
      addPrice(m.id, {
        inputMicrosPerMTok: input,
        cachedReadMicrosPerMTok: cached,
        outputMicrosPerMTok: output,
        sourceNote: v.note.trim(),
        ...(from ? { effectiveFrom: from.toISOString() } : {}),
      }),
    );
    if (ok) onClose();
  }
  const field = (key: keyof typeof v, label: string, hint?: string, required = true) => (
    <Field label={label} htmlFor={ids[key]} hint={hint}>
      <input
        id={ids[key]}
        required={required}
        inputMode={key === "note" || key === "from" ? undefined : "decimal"}
        className={FIELD}
        value={v[key]}
        aria-invalid={invalid && key !== "note" ? true : undefined}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      title={title}
      description={<p>{t("ai.prices.text")}</p>}
      size="md"
      busy={change.busy}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-3">
              {field("input", t("ai.prices.input"))}
              {field("cached", t("ai.prices.cached"), undefined, false)}
              {field("output", t("ai.prices.output"))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("note", t("ai.prices.note"), t("ai.prices.noteHint"))}
              <Field label={t("ai.prices.from")} htmlFor={ids.from} hint={t("ai.prices.fromHint")}>
                <input
                  id={ids.from}
                  type="datetime-local"
                  className={FIELD}
                  value={v.from}
                  onChange={(e) => setV({ ...v, from: e.target.value })}
                />
              </Field>
            </div>
            {invalid ? (
              <div className="mt-3">
                <FormMessage kind="error">{t("ai.prices.invalid")}</FormMessage>
              </div>
            ) : null}
            {change.error ? (
              <div className="mt-3">
                <FormMessage kind="error">{change.error}</FormMessage>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter hint={t("ai.prices.immutable")}>
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
              <span>{t("ai.prices.save")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

// =============================================================================================
// Tasks
// =============================================================================================

export function TasksPanel({
  tasks,
  models,
  priced,
  can,
}: {
  tasks: readonly AiTaskSettingDto[];
  models: readonly AiModelSummary[];
  /** Model ids with a price in force. */
  priced: readonly string[];
  can: AiPermissions;
}) {
  const t = useT();
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {tasks.map((task) => (
        <TaskRow key={task.task} task={task} models={models} priced={priced} can={can} />
      ))}
      {tasks.length === 0 ? (
        <li className="px-5 py-6 text-sm text-ink-3">{t("ai.tasks.empty")}</li>
      ) : null}
    </ul>
  );
}

function TaskRow({
  task,
  models,
  priced,
  can,
}: {
  task: AiTaskSettingDto;
  models: readonly AiModelSummary[];
  priced: readonly string[];
  can: AiPermissions;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const model = models.find((m) => m.id === task.modelId) ?? null;
  const available = task.task === "DIAGNOSTIC_PING";
  return (
    <li className="space-y-2 px-4 py-4 sm:px-5" data-task={task.task}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{t(`ai.tasks.names.${task.task}`)}</span>
        <StatusPill tone={task.enabled ? "success" : "neutral"}>
          {task.enabled ? t("ai.tasks.enabled") : t("ai.tasks.disabled")}
        </StatusPill>
        {available ? null : <StatusPill tone="neutral">{t("ai.tasks.later")}</StatusPill>}
      </div>
      <p className="text-xs text-ink-3">{t(`ai.tasks.descriptions.${task.task}`)}</p>
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Def term={t("ai.tasks.model")}>
          {model
            ? `${model.displayName} · ${PROVIDER_NAMES[model.provider]}`
            : t("ai.tasks.noModel")}
        </Def>
        <Def term={t("ai.tasks.limits")}>
          {t("ai.tasks.limitsValue", { input: task.maxInputTokens, output: task.maxOutputTokens })}
        </Def>
        <Def term={t("ai.tasks.thinking")}>{task.thinkingBudget || "—"}</Def>
        <Def term={t("ai.tasks.maxCost")}>{`$${microsToUsd(task.maxCostPerOpMicros)}`}</Def>
      </dl>
      {can.modelManage ? (
        <button
          type="button"
          className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs")}
          onClick={() => setOpen(true)}
          aria-label={`${t("ai.tasks.edit")}: ${t(`ai.tasks.names.${task.task}`)}`}
        >
          {t("ai.tasks.edit")}
        </button>
      ) : null}
      {open ? (
        <TaskDialog task={task} models={models} priced={priced} onClose={() => setOpen(false)} />
      ) : null}
    </li>
  );
}

function Def({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-3">{term}:</dt>
      <dd className="text-ink-2">{children}</dd>
    </div>
  );
}

function TaskDialog({
  task,
  models,
  priced,
  onClose,
}: {
  task: AiTaskSettingDto;
  models: readonly AiModelSummary[];
  priced: readonly string[];
  onClose: () => void;
}) {
  const t = useT();
  const ids = {
    enabled: useId(),
    model: useId(),
    input: useId(),
    output: useId(),
    thinking: useId(),
    cost: useId(),
    temp: useId(),
  };
  const change = useChange();
  const [v, setV] = useState({
    enabled: task.enabled,
    modelId: task.modelId ?? "",
    maxInputTokens: String(task.maxInputTokens),
    maxOutputTokens: String(task.maxOutputTokens),
    thinkingBudget: String(task.thinkingBudget),
    maxCost: microsToUsd(task.maxCostPerOpMicros),
    temperature: task.temperatureMilli === null ? "" : String(task.temperatureMilli / 1000),
  });
  const [invalid, setInvalid] = useState(false);
  const choices = usableModels(models);
  const name = t(`ai.tasks.names.${task.task}`);
  const title = t("ai.tasks.editTitle", { task: name });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const int = (s: string) => (/^\d{1,7}$/.test(s.trim()) ? Number(s.trim()) : NaN);
    const cost = usdToMicros(v.maxCost);
    const temp = v.temperature.trim() === "" ? null : Number(v.temperature.replace(",", "."));
    const numbers = [int(v.maxInputTokens), int(v.maxOutputTokens), int(v.thinkingBudget)];
    if (
      numbers.some((n) => Number.isNaN(n)) ||
      (numbers[0] as number) < 1 ||
      (numbers[1] as number) < 1 ||
      cost === null ||
      cost === "0" ||
      (temp !== null && (Number.isNaN(temp) || temp < 0 || temp > 2))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const ok = await change.run(() =>
      updateTask(task.task, {
        enabled: v.enabled,
        modelId: v.modelId || null,
        maxInputTokens: numbers[0] as number,
        maxOutputTokens: numbers[1] as number,
        thinkingBudget: numbers[2] as number,
        maxCostPerOpMicros: cost,
        temperatureMilli: temp === null ? null : Math.round(temp * 1000),
        version: task.version,
      }),
    );
    if (ok) onClose();
  }
  const num = (
    key: "maxInputTokens" | "maxOutputTokens" | "thinkingBudget",
    id: string,
    label: string,
    hint?: string,
  ) => (
    <Field label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        inputMode="numeric"
        required
        className={FIELD}
        value={v[key]}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      title={title}
      size="lg"
      busy={change.busy}
      closeLabel={t("ai.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <div className="space-y-4">
              <label htmlFor={ids.enabled} className="flex items-start gap-2 text-sm text-ink">
                <input
                  id={ids.enabled}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-petrol"
                  checked={v.enabled}
                  onChange={(e) => setV({ ...v, enabled: e.target.checked })}
                />
                <span>{t("ai.tasks.enableTask")}</span>
              </label>
              <Field label={t("ai.tasks.model")} htmlFor={ids.model} hint={t("ai.tasks.modelHint")}>
                <select
                  id={ids.model}
                  className={FIELD}
                  value={v.modelId}
                  onChange={(e) => setV({ ...v, modelId: e.target.value })}
                >
                  <option value="">{t("ai.tasks.noModel")}</option>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${m.displayName} · ${PROVIDER_NAMES[m.provider]}${priced.includes(m.id) ? "" : ` (${t("ai.tasks.noPrice")})`}`}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                {num("maxInputTokens", ids.input, t("ai.tasks.maxInput"))}
                {num("maxOutputTokens", ids.output, t("ai.tasks.maxOutput"))}
                {num(
                  "thinkingBudget",
                  ids.thinking,
                  t("ai.tasks.thinking"),
                  t("ai.tasks.thinkingHint"),
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("ai.tasks.maxCostField")}
                  htmlFor={ids.cost}
                  hint={t("ai.tasks.maxCostHint")}
                >
                  <input
                    id={ids.cost}
                    inputMode="decimal"
                    required
                    className={FIELD}
                    value={v.maxCost}
                    aria-invalid={invalid ? true : undefined}
                    onChange={(e) => setV({ ...v, maxCost: e.target.value })}
                  />
                </Field>
                <Field
                  label={t("ai.tasks.temperature")}
                  htmlFor={ids.temp}
                  hint={t("ai.tasks.temperatureHint")}
                >
                  <input
                    id={ids.temp}
                    inputMode="decimal"
                    className={FIELD}
                    value={v.temperature}
                    onChange={(e) => setV({ ...v, temperature: e.target.value })}
                  />
                </Field>
              </div>
              {invalid ? <FormMessage kind="error">{t("ai.tasks.invalid")}</FormMessage> : null}
              {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
            </div>
          </DialogBody>
          <DialogFooter>
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
              <span>{t("ai.common.save")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}
