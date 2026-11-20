"use client";

import type { CmsPageResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCms, type FieldIssue } from "../../lib/cms-client";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { buttonStyles, cx, Spinner } from "../ui";

/**
 * ML-2 (DP-074): the two translation actions of a page.
 *  - Create translation: a new page in another enabled language with the same structure and empty
 *    texts (a draft; nothing is published). The API refuses a language the group already has.
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
  missing: { locale: string; label: string }[];
  outdated: { latest: number } | null;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;

  if (!canEdit) return null;

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locale) return;
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { locale, title: String(form.get("title") ?? "") };
    if (slugEditable) body["slug"] = String(form.get("slug") ?? "");
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
            <span>{`Mark as up to date with revision ${outdated.latest}`}</span>
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
              <span>{`Create ${m.label} translation`}</span>
            </button>
          ))}
        </div>
      ) : null}

      {locale !== null ? (
        <form key="create-form" onSubmit={create} noValidate className="space-y-3">
          <p className="text-sm text-ink-2">
            {`The new page copies the sections, images and links of this page with empty texts. It is created as a draft; nothing is published.`}
          </p>
          <Field label="Translated title" htmlFor="translation-title">
            <input
              id="translation-title"
              name="title"
              required
              maxLength={200}
              autoFocus
              aria-invalid={invalid("title")}
              className={FIELD}
            />
          </Field>
          {slugEditable ? (
            <Field
              label="Address in this language"
              htmlFor="translation-slug"
              hint="Lower case and hyphens. The same address as the source is allowed."
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
                  defaultValue={slug ?? ""}
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
              <span>Create draft translation</span>
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
              <span>Cancel</span>
            </button>
          </div>
        </form>
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
