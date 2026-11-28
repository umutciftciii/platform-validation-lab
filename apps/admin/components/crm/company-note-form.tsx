"use client";
/**
 * CRM-2 (ADR-032 D7): a staff note on a company (crm:manage on its site). The note becomes a row
 * of the company history; it is never changed or deleted.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { CRM_NOTE_MAX } from "@dream/contracts";
import { addCompanyNote } from "../../lib/crm-client";
import { Field, FormMessage, TEXTAREA } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, Spinner } from "../ui";

export function CompanyNoteForm({ companyId }: { companyId: string }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await addCompanyNote(companyId, body);
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return;
    }
    setBody("");
    setMessage({ kind: "success", text: t("crm.history.noteAdded") });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field
        label={t("crm.history.noteLabel")}
        htmlFor={`${id}-note`}
        hint={t("crm.history.noteHint")}
      >
        <textarea
          id={`${id}-note`}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setMessage(null);
          }}
          maxLength={CRM_NOTE_MAX}
          rows={3}
          className={TEXTAREA}
        />
      </Field>
      {message ? (
        <FormMessage key={`msg-${message.kind}`} kind={message.kind}>
          <span>{message.text}</span>
        </FormMessage>
      ) : null}
      <button
        type="submit"
        className={buttonStyles.secondary}
        disabled={busy || body.trim() === ""}
      >
        {busy ? <Spinner key="busy" /> : null}
        <span>{busy ? t("crm.history.adding") : t("crm.history.addNote")}</span>
      </button>
    </form>
  );
}
