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
        label={article ? "Article title" : "Page title"}
        htmlFor="title"
        hint={
          article
            ? "The headline of the article on the site and in the news list."
            : "The name of the page in the admin and its default heading."
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
        label="Address"
        htmlFor="slug"
        hint={
          article
            ? "Lower case and hyphens, for example why-oil-prices-fell."
            : "Lower case and hyphens. Products, privacy, news and two-letter codes are reserved."
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
        The {article ? "article" : "page"} is created as a draft on {siteLabel}. Nothing is shown on
        the site until it is published.
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonStyles.primary}>
          {pending ? <Spinner /> : <Icon name="plus" size={17} />}
          Create draft
        </button>
      </div>
    </form>
  );
}
