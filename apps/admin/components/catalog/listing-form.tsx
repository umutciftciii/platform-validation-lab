"use client";

import {
  DESCRIPTION_MAX,
  type Category,
  type Listing,
  type ListingUpsertRequest,
  type ListingVisibility,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { flattenTree } from "../../lib/catalog-view";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { Field, FIELD, FormMessage, TEXTAREA } from "./parts";
import { useNotice } from "./notices";

/**
 * The product's listing on one site (product:edit of that site): visibility, the site's category
 * and the site's own English texts. Creating a listing without a category uses the site default.
 */
export function ListingForm({
  productId,
  siteId,
  siteName,
  listing,
  categories,
  canEdit,
  productArchived,
}: {
  productId: string;
  siteId: string;
  siteName: string;
  listing: Listing | null;
  categories: readonly Category[];
  canEdit: boolean;
  productArchived: boolean;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const [visibility, setVisibility] = useState<ListingVisibility>(listing?.visibility ?? "HIDDEN");
  const tree = flattenTree(categories);
  const defaultCategory = categories.find((c) => c.isDefault);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;
  const id = (name: string) => `listing-${siteId}-${name}`;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const categoryId = String(form.get("categoryId") ?? "");
    const body: ListingUpsertRequest = {
      version: listing?.version ?? null,
      categoryId: categoryId || null,
      visibility,
      sortOrder: Number.parseInt(String(form.get("sortOrder") ?? "0"), 10) || 0,
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      description: String(form.get("description") ?? ""),
    };
    setPending(true);
    setError(null);
    setIssues([]);
    setSaved(false);
    const result = await callCatalog<{ listing: Listing }>(
      "POST",
      `/products/${productId}/listings/${siteId}`,
      body,
    );
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setIssues(result.issues);
      return;
    }
    if (notify) notify(listing ? "Listing saved." : `Listed on ${siteName}.`);
    else setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <legend className="sr-only">Listing on {siteName}</legend>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Visibility on this site</span>
          <div role="radiogroup" aria-label="Visibility" className="grid grid-cols-2 gap-2">
            {(["VISIBLE", "HIDDEN"] as const).map((v) => {
              const active = visibility === v;
              const blocked = v === "VISIBLE" && productArchived;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!canEdit || blocked}
                  onClick={() => setVisibility(v)}
                  className={cx(
                    "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "border-petrol bg-petrol-soft text-ink ring-2 ring-petrol/20"
                      : "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
                  )}
                >
                  <Icon name={v === "VISIBLE" ? "eye" : "eyeOff"} size={17} />
                  <span>
                    <span className="block font-medium">
                      {v === "VISIBLE" ? "Visible" : "Hidden"}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {v === "VISIBLE" ? "Shown once published" : "Admin only"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {productArchived ? (
            <p className="mt-1 text-xs text-ink-3">Archived products cannot be visible.</p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field
            label="Category on this site"
            htmlFor={id("category")}
            hint={
              listing
                ? undefined
                : defaultCategory
                  ? `Left empty, the site default “${defaultCategory.name}” is used.`
                  : "This site has no default category yet."
            }
          >
            <select
              id={id("category")}
              name="categoryId"
              defaultValue={listing?.categoryId ?? ""}
              aria-invalid={invalid("categoryId")}
              className={FIELD}
            >
              {listing ? null : <option value="">Site default</option>}
              {tree.map(({ category, depth }) => (
                <option key={category.id} value={category.id}>
                  {" ".repeat(depth)}
                  {category.name}
                  {category.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort order" htmlFor={id("sort")}>
            <input
              id={id("sort")}
              name="sortOrder"
              type="number"
              inputMode="numeric"
              step={1}
              defaultValue={listing?.sortOrder ?? 0}
              className={cx(FIELD, "tabular")}
            />
          </Field>
        </div>
        <Field
          label="Title on this site"
          htmlFor={id("title")}
          hint="Optional. Without it the site shows the master name."
        >
          <input
            id={id("title")}
            name="title"
            maxLength={200}
            defaultValue={listing?.text?.title ?? ""}
            aria-invalid={invalid("title")}
            className={FIELD}
          />
        </Field>
        <Field label="Summary on this site" htmlFor={id("summary")}>
          <input
            id={id("summary")}
            name="summary"
            maxLength={500}
            defaultValue={listing?.text?.summary ?? ""}
            aria-invalid={invalid("summary")}
            className={FIELD}
          />
        </Field>
        <Field
          label="Description on this site"
          htmlFor={id("description")}
          hint="English only for now. Translations come later."
        >
          <textarea
            id={id("description")}
            name="description"
            rows={5}
            maxLength={DESCRIPTION_MAX}
            defaultValue={listing?.text?.description ?? ""}
            aria-invalid={invalid("description")}
            className={TEXTAREA}
          />
        </Field>
      </fieldset>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {saved ? <FormMessage kind="success">Listing saved.</FormMessage> : null}
      {canEdit ? (
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            {pending ? <Spinner /> : <Icon name={listing ? "edit" : "plus"} size={17} />}
            {pending ? "Saving…" : listing ? "Save listing" : `List on ${siteName}`}
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Icon name="shield" size={16} />
          Read only: editing this site&apos;s listings needs product:edit on the site.
        </p>
      )}
    </form>
  );
}
