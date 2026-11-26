"use client";
/**
 * DP-298 (ADR-031 D6): a provider's data-processing terms in the AI Center's provider card —
 * "Personal data: not allowed (no terms recorded)" or the recorded terms (DPA, GDPR and KVKK
 * transfer mechanisms shown separately, data region, retention, no training). Only the system
 * owner (`canManage`, module:manage) records, replaces or revokes them; the API asks for a fresh
 * step-up. Terms alone enable nothing: a task with personal data also needs an approved purpose
 * (packages/contracts/src/data-processing.ts) and an allowed transport.
 */
import { useId, useState, type FormEvent } from "react";
import {
  AI_KVKK_TRANSFER_MECHANISMS,
  AI_TRANSFER_MECHANISMS,
  type AiProviderDataTermsResponse,
  type AiProviderKey,
} from "@dream/contracts";
import { recordAiDataTerms, revokeAiDataTerms } from "../../lib/data-processing-client";
import { PROVIDER_NAMES } from "../../lib/ai-view";
import { dataTermsComplete, type DataTermsDraft } from "../../lib/legal-texts-view";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useT } from "../i18n/locale-provider";
import { useDataChange, useLegalDate } from "../legal/legal-texts";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

export function AiDataTerms({
  provider,
  terms,
}: {
  provider: AiProviderKey;
  /** null: the terms could not be loaded. */
  terms: AiProviderDataTermsResponse | null;
}) {
  const t = useT();
  const date = useLegalDate();
  const [dialog, setDialog] = useState<null | "record" | "revoke">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId();
  const name = PROVIDER_NAMES[provider];
  const current = terms?.current ?? null;
  const earlier = terms ? terms.history.filter((h) => h.id !== current?.id).length : 0;
  return (
    <div aria-labelledby={headingId} role="group" className="space-y-2 border-t border-line pt-3">
      <p id={headingId} className="text-xs font-medium uppercase tracking-wide text-ink-3">
        {t("legal.aiTerms.title")}
      </p>
      {terms === null ? (
        <p key="error" role="alert" className="text-sm text-danger">
          {t("legal.aiTerms.loadError")}
        </p>
      ) : current ? (
        <div key="terms" className="space-y-2">
          <StatusPill tone="success">{t("legal.aiTerms.recorded")}</StatusPill>
          <dl className="grid grid-cols-1 gap-1.5 text-xs">
            {(
              [
                ["dpaReference", current.dpaReference],
                ["dpaSignedOn", current.dpaSignedOn],
                ["transferMechanism", t(`legal.aiTerms.gdpr.${current.transferMechanism}`)],
                ["kvkkTransferMechanism", t(`legal.aiTerms.kvkk.${current.kvkkTransferMechanism}`)],
                ["dataRegion", current.dataRegion],
                ["retentionSetting", current.retentionSetting],
              ] as const
            ).map(([field, value]) => (
              <div key={field} className="min-w-0">
                <dt className="text-ink-3">{t(`legal.aiTerms.fields.${field}`)}</dt>
                <dd className="break-words text-ink">{value}</dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="text-ink-3">{t("legal.aiTerms.fields.noTraining")}</dt>
              <dd className="text-ink">{t("legal.aiTerms.confirmed")}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-3">
            {t("legal.aiTerms.recordedBy", {
              name: current.recordedBy,
              date: date(current.recordedAt),
            })}
          </p>
        </div>
      ) : (
        <StatusPill key="none" tone="neutral">
          {t("legal.aiTerms.none")}
        </StatusPill>
      )}
      {earlier > 0 ? (
        <p key="earlier" className="text-xs text-ink-3">
          {t("legal.aiTerms.earlier", { count: earlier })}
        </p>
      ) : null}
      <p className="text-xs text-ink-3">{t("legal.aiTerms.alone")}</p>
      {terms?.canManage ? (
        <div key="actions" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={cx(buttonStyles.secondary, "h-8 px-2.5 text-xs")}
            onClick={() => {
              setNotice(null);
              setDialog("record");
            }}
          >
            {current ? t("legal.aiTerms.replace") : t("legal.aiTerms.record")}
          </button>
          {current ? (
            <button
              key="revoke"
              type="button"
              className={cx(buttonStyles.ghost, "h-8 px-2.5 text-xs text-danger hover:text-danger")}
              onClick={() => {
                setNotice(null);
                setDialog("revoke");
              }}
              aria-label={t("legal.aiTerms.revokeLabel", { provider: name })}
            >
              {t("legal.aiTerms.revoke")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite">
        {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
      </div>
      {dialog === "record" ? (
        <TermsDialog
          provider={provider}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setDialog(null);
            setNotice(m);
          }}
        />
      ) : null}
      {dialog === "revoke" ? (
        <RevokeDialog
          provider={provider}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setDialog(null);
            setNotice(m);
          }}
        />
      ) : null}
    </div>
  );
}

const EMPTY: DataTermsDraft = {
  dpaReference: "",
  dpaSignedOn: "",
  transferMechanism: "",
  kvkkTransferMechanism: "",
  dataRegion: "",
  retentionSetting: "",
  noTraining: false,
};

function TermsDialog({
  provider,
  onClose,
  onDone,
}: {
  provider: AiProviderKey;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const ids = {
    dpa: useId(),
    signed: useId(),
    gdpr: useId(),
    kvkk: useId(),
    region: useId(),
    retention: useId(),
    training: useId(),
    trainingHint: useId(),
  };
  const change = useDataChange();
  const [d, setD] = useState<DataTermsDraft>(EMPTY);
  const set = <K extends keyof DataTermsDraft>(k: K, v: DataTermsDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const title = t("legal.aiTerms.formTitle", { provider: PROVIDER_NAMES[provider] });
  const complete = dataTermsComplete(d);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    await change.run(
      () =>
        recordAiDataTerms(provider, {
          dpaReference: d.dpaReference.trim(),
          dpaSignedOn: d.dpaSignedOn,
          transferMechanism: d.transferMechanism as (typeof AI_TRANSFER_MECHANISMS)[number],
          kvkkTransferMechanism:
            d.kvkkTransferMechanism as (typeof AI_KVKK_TRANSFER_MECHANISMS)[number],
          dataRegion: d.dataRegion.trim(),
          retentionSetting: d.retentionSetting.trim(),
          noTraining: true,
        }),
      () => onDone(t("legal.aiTerms.saved")),
    );
  }
  return (
    <Dialog
      title={title}
      description={<p>{t("legal.aiTerms.formText")}</p>}
      size="md"
      busy={change.busy}
      dirty={JSON.stringify(d) !== JSON.stringify(EMPTY)}
      closeLabel={t("legal.texts.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <Field
              label={t("legal.aiTerms.fields.dpaReference")}
              htmlFor={ids.dpa}
              hint={t("legal.aiTerms.hints.dpaReference")}
            >
              <input
                id={ids.dpa}
                required
                maxLength={200}
                className={FIELD}
                value={d.dpaReference}
                onChange={(e) => set("dpaReference", e.target.value)}
              />
            </Field>
            <Field label={t("legal.aiTerms.fields.dpaSignedOn")} htmlFor={ids.signed}>
              <input
                id={ids.signed}
                type="date"
                required
                className={FIELD}
                value={d.dpaSignedOn}
                onChange={(e) => set("dpaSignedOn", e.target.value)}
              />
            </Field>
            <Field label={t("legal.aiTerms.fields.transferMechanism")} htmlFor={ids.gdpr}>
              <select
                id={ids.gdpr}
                required
                className={FIELD}
                value={d.transferMechanism}
                onChange={(e) => set("transferMechanism", e.target.value)}
              >
                <option value="" disabled>
                  {t("legal.aiTerms.fields.transferMechanism")}
                </option>
                {AI_TRANSFER_MECHANISMS.map((m) => (
                  <option key={m} value={m}>
                    {t(`legal.aiTerms.gdpr.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("legal.aiTerms.fields.kvkkTransferMechanism")} htmlFor={ids.kvkk}>
              <select
                id={ids.kvkk}
                required
                className={FIELD}
                value={d.kvkkTransferMechanism}
                onChange={(e) => set("kvkkTransferMechanism", e.target.value)}
              >
                <option value="" disabled>
                  {t("legal.aiTerms.fields.kvkkTransferMechanism")}
                </option>
                {AI_KVKK_TRANSFER_MECHANISMS.map((m) => (
                  <option key={m} value={m}>
                    {t(`legal.aiTerms.kvkk.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("legal.aiTerms.fields.dataRegion")}
              htmlFor={ids.region}
              hint={t("legal.aiTerms.hints.dataRegion")}
            >
              <input
                id={ids.region}
                required
                maxLength={100}
                className={FIELD}
                value={d.dataRegion}
                onChange={(e) => set("dataRegion", e.target.value)}
              />
            </Field>
            <Field
              label={t("legal.aiTerms.fields.retentionSetting")}
              htmlFor={ids.retention}
              hint={t("legal.aiTerms.hints.retentionSetting")}
            >
              <input
                id={ids.retention}
                required
                maxLength={200}
                className={FIELD}
                value={d.retentionSetting}
                onChange={(e) => set("retentionSetting", e.target.value)}
              />
            </Field>
            <div>
              <label htmlFor={ids.training} className="flex items-start gap-2 text-sm text-ink">
                <input
                  id={ids.training}
                  type="checkbox"
                  required
                  aria-describedby={ids.trainingHint}
                  className="mt-0.5 size-4 accent-petrol"
                  checked={d.noTraining}
                  onChange={(e) => set("noTraining", e.target.checked)}
                />
                <span>{t("legal.aiTerms.fields.noTraining")}</span>
              </label>
              <p id={ids.trainingHint} className="mt-1 pl-6 text-xs text-ink-3">
                {t("legal.aiTerms.hints.noTraining")}
              </p>
            </div>
            {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
          </DialogBody>
          <DialogFooter hint={t("legal.aiTerms.alone")}>
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={onClose}
              disabled={change.busy}
            >
              {t("legal.texts.common.cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={change.busy || !complete}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>{t("legal.aiTerms.record")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}

function RevokeDialog({
  provider,
  onClose,
  onDone,
}: {
  provider: AiProviderKey;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const change = useDataChange();
  if (change.stepUp) {
    return (
      <Dialog
        title={t("owner.stepUp.form")}
        onClose={() => {
          change.clear();
          onClose();
        }}
      >
        {change.stepUp("dialog")}
      </Dialog>
    );
  }
  return (
    <ConfirmDialog
      title={t("legal.aiTerms.revokeTitle")}
      text={t("legal.aiTerms.revokeText")}
      confirmLabel={t("legal.aiTerms.revoke")}
      confirmAriaLabel={t("legal.aiTerms.revokeLabel", { provider: PROVIDER_NAMES[provider] })}
      cancelLabel={t("legal.texts.common.cancel")}
      danger
      pending={change.busy}
      error={change.error}
      onCancel={() => {
        change.clear();
        onClose();
      }}
      onConfirm={() =>
        void change.run(
          () => revokeAiDataTerms(provider),
          () => onDone(t("legal.aiTerms.revoked")),
        )
      }
    />
  );
}
