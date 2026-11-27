"use client";

import type { CmsPageResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCms, type FieldIssue } from "../../lib/cms-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { buttonStyles, cx, Spinner } from "../ui";

/**
 * ML-2 (DP-074): the two translation actions of a page.
 *  - Create translation: a new page in another enabled language with the same structure and empty
 *    texts (a draft; nothing is published). The API refuses a language the group already has.
 *    ML-7: the menus in Dutch may start from the prepared proposal (still a draft).
 *  - Mark as up to date: records the source revision the translation now matches.
 */
export function TranslationActions({
  pageId,
  version,
  siteParam,
  canEdit,
  slugEditable,
  slug,
  slugPrefix,
  missing,
  outdated,
}: {
  pageId: string;
  version: number;
  siteParam: string;
  canEdit: boolean;
  slugEditable: boolean;
  slug: string | null;
  slugPrefix: string;
  /**
   * ML-7: `proposal` — the language has a reviewed-pending proposal for this page (menus, nl).
   * COM-5: the corporate Turkish proposals also bring their Turkish title and slug.
   */
  missing: {
    locale: string;
    label: string;
    proposal?: boolean;
    proposalTitle?: string | null;
    proposalSlug?: string | null;
  }[];
  outdated: { latest: number } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [locale, setLocale] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;

  if (!canEdit) return null;
  const offersProposal = missing.some((m) => m.locale === locale && m.proposal);
  const chosen = missing.find((m) => m.locale === locale);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locale) return;
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { locale, title: String(form.get("title") ?? "") };
    if (slugEditable) body["slug"] = String(form.get("slug") ?? "");
    if (offersProposal && form.get("proposal") === "on") body["proposal"] = true;
    setPending(true);
    setError(null);
    setIssues([]);
    const res = await callCms<CmsPageResponse>(`/pages/${pageId}/translations`, body);
    if (!res.ok) {
      setPending(false);
      setError(res.message);
      setIssues(res.issues);
      return;
    }
    router.push(`/content/${res.data.page.id}?site=${siteParam}`);
  }

  async function markUpToDate(latest: number) {
    setPending(true);
    setError(null);
    const res = await callCms<CmsPageResponse>(`/pages/${pageId}/translation-source`, {
      version,
      revisionNumber: latest,
    });
    setPending(false);
    if (!res.ok) return setError(res.message);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {outdated ? (
        <div key="outdated" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => markUpToDate(outdated.latest)}
            className={cx(buttonStyles.secondary, "h-9")}
          >
            {pending ? <Spinner /> : null}
            <span>
              {t("content.editor.translationActions.markUpToDate", { n: outdated.latest })}
            </span>
          </button>
        </div>
      ) : null}

      {missing.length > 0 && locale === null ? (
        <div key="create-buttons" className="flex flex-wrap gap-2">
          {missing.map((m) => (
            <button
              key={`create-${m.locale}`}
              type="button"
              onClick={() => setLocale(m.locale)}
              className={cx(buttonStyles.secondary, "h-9")}
            >
              <span>{t("content.editor.translationActions.create", { language: m.label })}</span>
            </button>
          ))}
        </div>
      ) : null}

      {locale !== null ? (
        <form key="create-form" onSubmit={create} noValidate className="space-y-3">
          <p className="text-sm text-ink-2">{t("content.editor.translationActions.copyNote")}</p>
          {offersProposal ? (
            <label key="proposal" className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                name="proposal"
                defaultChecked
                className="mt-0.5 h-4 w-4 rounded border-line-strong"
              />
              <span>{t("content.editor.translationActions.proposal")}</span>
            </label>
          ) : null}
          <Field label={t("content.editor.translationActions.title")} htmlFor="translation-title">
            <input
              id="translation-title"
              name="title"
              required
              maxLength={200}
              defaultValue={chosen?.proposalTitle ?? undefined}
              autoFocus
              aria-invalid={invalid("title")}
              className={FIELD}
            />
          </Field>
          {slugEditable ? (
            <Field
              label={t("content.editor.translationActions.slug")}
              htmlFor="translation-slug"
              hint={t("content.editor.translationActions.slugHint")}
            >
              <div className="flex items-center rounded-lg">
                <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-line-strong bg-surface-2 px-3 font-mono text-sm text-ink-3">
                  {`/${locale}${slugPrefix}`}
                </span>
                <input
                  id="translation-slug"
                  name="slug"
                  required
                  maxLength={80}
                  defaultValue={chosen?.proposalSlug ?? slug ?? ""}
                  spellCheck={false}
                  aria-invalid={invalid("slug")}
                  className={cx(FIELD, "rounded-l-none font-mono")}
                />
              </div>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonStyles.primary}>
              {pending ? <Spinner /> : null}
              <span>{t("content.editor.translationActions.submit")}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setLocale(null);
                setError(null);
                setIssues([]);
              }}
              className={cx(buttonStyles.secondary, "h-10")}
            >
              <span>{t("content.editor.translationActions.cancel")}</span>
            </button>
          </div>
        </form>
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
