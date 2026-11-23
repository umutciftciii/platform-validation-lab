"use client";

import type {
  CmsArticleCreateRequest,
  CmsPageCreateRequest,
  CmsPageResponse,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCms, type FieldIssue } from "../../lib/cms-client";
import { slugify } from "../catalog/product-master-form";
import { Field, FIELD, FormMessage } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";

/**
 * Creates an empty TEMPLATE page, or a news article with `template="article"` (DP-020), as a draft
 * (content:edit of the site); the editor opens next.
 */
export function PageCreateForm({
  siteId,
  siteParam,
  siteLabel,
  template = "standard",
}: {
  siteId: string;
  siteParam: string;
  siteLabel: string;
  template?: "standard" | "article";
}) {
  const article = template === "article";
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "");
    const body: CmsPageCreateRequest | CmsArticleCreateRequest = article
      ? { title, slug, template: "article" }
      : { title, slug };
    setPending(true);
    setError(null);
    setIssues([]);
    const result = await callCms<CmsPageResponse>(`/sites/${siteId}/pages`, body);
    if (!result.ok) {
      setPending(false);
      setError(result.message);
      setIssues(result.issues);
      return;
    }
    router.push(`/content/${result.data.page.id}?site=${siteParam}`);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label={
          article
            ? t("content.pages.createForm.articleTitle")
            : t("content.pages.createForm.pageTitle")
        }
        htmlFor="title"
        hint={
          article
            ? t("content.pages.createForm.articleTitleHint")
            : t("content.pages.createForm.pageTitleHint")
        }
      >
        <input
          id="title"
          name="title"
          required
          maxLength={200}
          autoFocus
          aria-invalid={invalid("title")}
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.currentTarget.value).slice(0, 80));
          }}
          className={FIELD}
        />
      </Field>
      <Field
        label={t("content.pages.createForm.address")}
        htmlFor="slug"
        hint={
          article
            ? t("content.pages.createForm.articleSlugHint")
            : t("content.pages.createForm.pageSlugHint")
        }
      >
        <div className="flex items-center rounded-lg">
          <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-line-strong bg-surface-2 px-3 font-mono text-sm text-ink-3">
            {article ? "/news/" : "/"}
          </span>
          <input
            id="slug"
            name="slug"
            required
            maxLength={80}
            value={slug}
            spellCheck={false}
            aria-invalid={invalid("slug")}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.currentTarget.value);
            }}
            className={cx(FIELD, "rounded-l-none font-mono")}
          />
        </div>
      </Field>
      <p className="text-sm text-ink-3">
        {article
          ? t("content.pages.createForm.articleDraftNote", { site: siteLabel })
          : t("content.pages.createForm.pageDraftNote", { site: siteLabel })}
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonStyles.primary}>
          {pending ? <Spinner /> : <Icon name="plus" size={17} />}
          <span>{t("content.pages.createForm.create")}</span>
        </button>
      </div>
    </form>
  );
}
