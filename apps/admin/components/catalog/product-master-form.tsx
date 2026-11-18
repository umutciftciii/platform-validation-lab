"use client";

import {
  DESCRIPTION_MAX,
  type Product,
  type ProductCreateRequest,
  type ProductUpdateRequest,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { formHasChanges } from "../../lib/product-tabs";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { Field, FIELD, FormMessage, TEXTAREA } from "./parts";
import { useNotice } from "./notices";
import { useUnsavedChanges } from "./product-tabs";

/** "ICCSYN 6 Synthetic" -> "iccsyn-6-synthetic" (the user can still change it). */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Create or edit a platform product master (product_master:edit). Without that permission the
 * same fields render read-only; the API decides either way.
 */
export function ProductMasterForm({
  product,
  canEdit,
  siteParam,
}: {
  product: Product | null;
  canEdit: boolean;
  siteParam: string;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [slug, setSlug] = useState(product?.slug ?? "");
  const archived = product?.status === "ARCHIVED";
  const readOnly = !canEdit || archived;
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;
  // DP-187: unsaved edits keep their tab marked and survive a save in another tab.
  const [changed, setChanged] = useState(false);
  useUnsavedChanges(Boolean(product) && !readOnly && changed);
  const track = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    // The slug is controlled (its DOM default follows the state), so it is compared here.
    const slugField = form.elements.namedItem("slug");
    const slugChanged =
      product !== null && slugField instanceof HTMLInputElement && slugField.value !== product.slug;
    setChanged(formHasChanges(form) || slugChanged);
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const form = new FormData(e.currentTarget);
    const body: ProductCreateRequest = {
      code: String(form.get("code") ?? ""),
      slug: String(form.get("slug") ?? ""),
      name: String(form.get("name") ?? ""),
      summary: String(form.get("summary") ?? ""),
      description: String(form.get("description") ?? ""),
    };
    setPending(true);
    setError(null);
    setIssues([]);
    setSaved(false);
    const result = product
      ? await callCatalog<{ product: Product }>("POST", `/products/${product.id}`, {
          ...body,
          version: product.version,
        } satisfies ProductUpdateRequest)
      : await callCatalog<{ product: Product }>("POST", "/products", body);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setIssues(result.issues);
      return;
    }
    if (product) {
      // The provider's notice outlives this form's remount after the refresh (new version).
      setChanged(false);
      if (notify) notify("Shared product content saved.");
      else setSaved(true);
      router.refresh();
    } else {
      router.push(`/products/${result.data.product.id}?site=${siteParam}`);
    }
  }

  return (
    <form onSubmit={submit} onInput={track} onChange={track} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Product name"
          htmlFor="name"
          className="sm:col-span-2"
          hint="Shared by every site; a site shows it when its own title is empty."
        >
          <input
            id="name"
            name="name"
            required
            maxLength={200}
            defaultValue={product?.name}
            readOnly={readOnly}
            aria-invalid={invalid("name")}
            onChange={(e) => {
              if (!slugTouched) setSlug(slugify(e.currentTarget.value));
            }}
            className={FIELD}
          />
        </Field>
        <Field label="Product code" htmlFor="code" hint="Upper case, e.g. ICC-SYN-6. Unique.">
          <input
            id="code"
            name="code"
            required
            maxLength={64}
            defaultValue={product?.code}
            readOnly={readOnly}
            aria-invalid={invalid("code")}
            autoCapitalize="characters"
            spellCheck={false}
            className={cx(FIELD, "font-mono uppercase")}
          />
        </Field>
        <Field
          label="URL slug"
          htmlFor="slug"
          hint={
            product
              ? "Lower case and hyphens. Unique. A new slug reaches a site when the product is published there again; the BV site then redirects the old address (301)."
              : "Lower case and hyphens. Unique."
          }
        >
          <input
            id="slug"
            name="slug"
            required
            maxLength={120}
            value={slug}
            readOnly={readOnly}
            aria-invalid={invalid("slug")}
            spellCheck={false}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.currentTarget.value);
            }}
            className={cx(FIELD, "font-mono")}
          />
        </Field>
        <Field
          label="Shared summary"
          htmlFor="summary"
          className="sm:col-span-2"
          hint="Optional. Used only on sites whose own summary is empty."
        >
          <input
            id="summary"
            name="summary"
            maxLength={500}
            defaultValue={product?.summary ?? ""}
            readOnly={readOnly}
            aria-invalid={invalid("summary")}
            className={FIELD}
          />
        </Field>
        <Field
          label="Shared description"
          htmlFor="description"
          className="sm:col-span-2"
          hint={`Optional. Used only on sites whose own description is empty. Plain text, English, up to ${DESCRIPTION_MAX.toLocaleString("en")} characters.`}
        >
          <textarea
            id="description"
            name="description"
            rows={6}
            maxLength={DESCRIPTION_MAX}
            defaultValue={product?.description ?? ""}
            readOnly={readOnly}
            aria-invalid={invalid("description")}
            className={TEXTAREA}
          />
        </Field>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {saved ? <FormMessage kind="success">Shared product content saved.</FormMessage> : null}
      {readOnly ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Icon name="shield" size={16} />
          {archived
            ? "This product is archived. Restore it to edit the master."
            : "Product masters are edited by the platform product team (product_master:edit)."}
        </p>
      ) : (
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            {pending ? <Spinner /> : <Icon name={product ? "edit" : "plus"} size={17} />}
            <span>{pending ? "Saving…" : product ? "Save shared content" : "Create product"}</span>
          </button>
        </div>
      )}
    </form>
  );
}

/** Archive or restore a master (product_master:edit). */
export function ProductStateButton({ product }: { product: Product }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archive = product.status !== "ARCHIVED";

  async function run() {
    if (archive && !window.confirm("Archive this product? It can be restored later.")) return;
    setPending(true);
    setError(null);
    const result = await callCatalog<{ product: Product }>(
      "POST",
      `/products/${product.id}/${archive ? "archive" : "restore"}`,
      { version: product.version },
    );
    setPending(false);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={run} disabled={pending} className={buttonStyles.secondary}>
        {pending ? <Spinner /> : <Icon name={archive ? "archive" : "refresh"} size={17} />}
        <span>{archive ? "Archive" : "Restore"}</span>
      </button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
