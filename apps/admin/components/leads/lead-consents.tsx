"use client";
/**
 * DP-298 (ADR-031 D4): the Consents panel of a lead — the current state per consent purpose
 * (Granted / Withdrawn / Never given), the history (a grant: the form and the consent text
 * version; a withdrawal: how it reached the company and who recorded it) and, with lead:manage on
 * the lead's site (`canWithdraw`), the withdrawal of a GRANTED consent. Notices are information,
 * not consent, and are never listed here (they stay with each request).
 *
 * A withdrawal records only a channel code (no free text, so no new personal data); the earlier
 * grant stays in the history as evidence. The API decides again (lead:manage, state GRANTED).
 */
import { useId, useState, type FormEvent } from "react";
import type { ConsentPurpose, ConsentState, LeadConsentsResponse } from "@dream/contracts";
import { withdrawLeadConsent } from "../../lib/data-processing-client";
import {
  CONSENT_TONE,
  canWithdrawPurpose,
  consentRecordLines,
  consentStateLabel,
  WITHDRAWAL_CHANNELS,
} from "../../lib/legal-texts-view";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { Dialog, DialogBody, DialogFooter, DialogForm } from "../dialog";
import { useT } from "../i18n/locale-provider";
import { useDataChange, useLegalDate } from "../legal/legal-texts";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

export function LeadConsents({
  leadId,
  consents,
}: {
  leadId: string;
  consents: LeadConsentsResponse;
}) {
  const t = useT();
  const date = useLegalDate();
  const [withdrawing, setWithdrawing] = useState<ConsentPurpose | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listId = useId();
  const anyGranted = consents.states.some((s) => s.state === "GRANTED");
  return (
    <div className="space-y-5">
      <ul aria-label={t("legal.consents.currentLabel")} className="grid gap-3 sm:grid-cols-3">
        {consents.states.map((s) => (
          <ConsentStateCard
            key={s.purpose}
            state={s}
            canWithdraw={consents.canWithdraw}
            onWithdraw={() => {
              setNotice(null);
              setWithdrawing(s.purpose);
            }}
            date={date}
          />
        ))}
      </ul>
      {!consents.canWithdraw && anyGranted ? (
        <p key="readOnly" className="text-sm text-ink-3">
          {t("legal.consents.readOnly")}
        </p>
      ) : null}
      <div aria-live="polite">
        {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
      </div>
      <div className="space-y-2">
        <h3 id={listId} className="text-sm font-semibold text-ink">
          {t("legal.consents.history")}
        </h3>
        {consents.history.length ? (
          <ol key="history" aria-labelledby={listId} className="divide-y divide-line text-sm">
            {consents.history.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-4">
                <span className="shrink-0 tabular-nums text-ink-3 sm:w-44">
                  {date(r.createdAt)}
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {t(`legal.consents.purposes.${r.purpose}`)}
                    </span>
                    <StatusPill tone={CONSENT_TONE[r.action]}>
                      {consentStateLabel(r.action, t)}
                    </StatusPill>
                  </span>
                  {consentRecordLines(r, t).map((line) => (
                    <span key={line} className="block text-ink-2">
                      {line}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p key="empty" className="text-sm text-ink-3">
            {t("legal.consents.historyEmpty")}
          </p>
        )}
      </div>
      {withdrawing ? (
        <WithdrawDialog
          leadId={leadId}
          purpose={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={(message) => {
            setWithdrawing(null);
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

function ConsentStateCard({
  state: s,
  canWithdraw,
  onWithdraw,
  date,
}: {
  state: ConsentState;
  canWithdraw: boolean;
  onWithdraw: () => void;
  date: (iso: string | null) => string;
}) {
  const t = useT();
  const purpose = t(`legal.consents.purposes.${s.purpose}`);
  return (
    <li className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-sm font-medium text-ink">{purpose}</p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <StatusPill tone={CONSENT_TONE[s.state ?? "none"]}>
          {consentStateLabel(s.state, t)}
        </StatusPill>
        {s.since ? (
          <span key="since">{t("legal.consents.since", { date: date(s.since) })}</span>
        ) : null}
      </p>
      {canWithdrawPurpose(s, canWithdraw) ? (
        <button
          key="withdraw"
          type="button"
          className={cx(buttonStyles.secondary, "h-8 px-2.5 text-xs")}
          onClick={onWithdraw}
          aria-label={t("legal.consents.withdrawLabel", { purpose })}
        >
          {t("legal.consents.withdraw")}
        </button>
      ) : null}
    </li>
  );
}

function WithdrawDialog({
  leadId,
  purpose,
  onClose,
  onDone,
}: {
  leadId: string;
  purpose: ConsentPurpose;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const id = useId();
  const change = useDataChange();
  const [channel, setChannel] = useState<(typeof WITHDRAWAL_CHANNELS)[number] | "">("");
  const title = t("legal.consents.withdrawTitle", {
    purpose: t(`legal.consents.purposes.${purpose}`),
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!channel) return;
    await change.run(
      () => withdrawLeadConsent(leadId, purpose, { channel }),
      () => onDone(t("legal.consents.withdrawnOk")),
    );
  }
  return (
    <Dialog
      title={title}
      role="alertdialog"
      description={<p>{t("legal.consents.withdrawText")}</p>}
      danger
      busy={change.busy}
      dirty={channel !== ""}
      closeLabel={t("legal.texts.common.close")}
      onClose={onClose}
    >
      {change.stepUp ? (
        change.stepUp("dialog")
      ) : (
        <DialogForm onSubmit={submit} label={title}>
          <DialogBody>
            <Field label={t("legal.consents.channel")} htmlFor={id}>
              <select
                id={id}
                required
                className={FIELD}
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                <option value="" disabled>
                  {t("legal.consents.channel")}
                </option>
                {WITHDRAWAL_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(`legal.consents.channels.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            {change.error ? <FormMessage kind="error">{change.error}</FormMessage> : null}
          </DialogBody>
          <DialogFooter>
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
              className={buttonStyles.danger}
              disabled={change.busy || channel === ""}
            >
              {change.busy ? <Spinner size={14} /> : null}
              <span>{t("legal.consents.confirm")}</span>
            </button>
          </DialogFooter>
        </DialogForm>
      )}
    </Dialog>
  );
}
