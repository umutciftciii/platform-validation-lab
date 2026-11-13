"use client";

/**
 * Global brand catalogue (PM-6, DP-036): other manufacturers' brands and their products with
 * grade. Platform-wide reference data; changed with product_master:edit, archived never deleted.
 * A change of a global product makes verifications based on its old version stale.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  CATALOG_API,
  GLOBAL_BRAND_NAME_MAX,
  GLOBAL_GRADE_MAX,
  GLOBAL_MANUFACTURER_MAX,
  GLOBAL_NOTES_MAX,
  GLOBAL_PRODUCT_NAME_MAX,
  GlobalProductListResponseSchema,
  type GlobalBrand,
  type GlobalProduct,
} from "@dream/contracts";
import { callCatalog } from "../../lib/catalog-client";
import { Icon } from "../icons";
import { buttonStyles, cx, StatusPill } from "../ui";
import { useNotice } from "./notices";
import { Field, FIELD, FormMessage, TEXTAREA } from "./parts";

interface BrandDraft {
  name: string;
  manufacturer: string;
  country: string;
  notes: string;
}

const emptyBrand: BrandDraft = { name: "", manufacturer: "", country: "", notes: "" };

export function GlobalCatalogManager({
  brands: initial,
  canEdit,
}: {
  brands: GlobalBrand[];
  canEdit: boolean;
}) {
  const [brands, setBrands] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const notify = useNotice();

  const put = (b: GlobalBrand, message: string) => {
    setBrands((list) =>
      list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? b : x)) : [b, ...list],
    );
    notify?.(message, "success");
  };
  const term = q.trim().toLowerCase();
  const shown = term
    ? brands.filter(
        (b) => b.name.toLowerCase().includes(term) || b.manufacturer.toLowerCase().includes(term),
      )
    : brands;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3" aria-live="polite">
        {brands.length} {brands.length === 1 ? "brand" : "brands"}
        {term ? ` · ${shown.length} shown` : ""}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <label htmlFor="brand-filter" className="sr-only">
            Filter brands
          </label>
          <input
            id="brand-filter"
            className={cx(FIELD, "pl-9")}
            placeholder="Filter by brand or manufacturer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
        </div>
        {canEdit && !adding ? (
          <button type="button" className={buttonStyles.primary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} />
            New brand
          </button>
        ) : null}
      </div>
      {adding ? (
        <BrandForm
          initial={emptyBrand}
          submitLabel="Create brand"
          onCancel={() => setAdding(false)}
          onSubmit={async (d) => {
            const r = await callCatalog<{ brand: GlobalBrand }>("POST", "/global-brands", d);
            if (!r.ok) return r.message;
            setAdding(false);
            put(r.data.brand, `Brand ${r.data.brand.name} created.`);
            return null;
          }}
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3">
          {brands.length === 0 ? "No global brands yet." : "No brand matches the filter."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((b) => (
            <BrandCard key={b.id} brand={b} canEdit={canEdit} onChange={put} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BrandForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: BrandDraft;
  submitLabel: string;
  onSubmit: (d: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const message = await onSubmit({
      name: d.name,
      manufacturer: d.manufacturer,
      country: d.country || null,
      notes: d.notes || null,
    });
    setBusy(false);
    setError(message);
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-raised sm:grid-cols-2"
    >
      <Field label="Brand name" htmlFor={`${id}-n`}>
        <input
          id={`${id}-n`}
          className={FIELD}
          required
          maxLength={GLOBAL_BRAND_NAME_MAX}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </Field>
      <Field label="Manufacturer" htmlFor={`${id}-m`}>
        <input
          id={`${id}-m`}
          className={FIELD}
          required
          maxLength={GLOBAL_MANUFACTURER_MAX}
          value={d.manufacturer}
          onChange={(e) => setD({ ...d, manufacturer: e.target.value })}
        />
      </Field>
      <Field label="Country (ISO code)" htmlFor={`${id}-c`} hint="Two letters, e.g. NL, GB, US.">
        <input
          id={`${id}-c`}
          className={cx(FIELD, "uppercase")}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          value={d.country}
          onChange={(e) => setD({ ...d, country: e.target.value })}
        />
      </Field>
      <Field label="Notes (internal)" htmlFor={`${id}-o`} className="sm:col-span-2">
        <textarea
          id={`${id}-o`}
          className={cx(TEXTAREA, "min-h-20")}
          maxLength={GLOBAL_NOTES_MAX}
          value={d.notes}
          onChange={(e) => setD({ ...d, notes: e.target.value })}
        />
      </Field>
      {error ? (
        <div className="sm:col-span-2">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={buttonStyles.primary} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function BrandCard({
  brand,
  canEdit,
  onChange,
}: {
  brand: GlobalBrand;
  canEdit: boolean;
  onChange: (b: GlobalBrand, message: string) => void;
}) {
  const id = useId();
  const router = useRouter();
  const notify = useNotice();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [products, setProducts] = useState<GlobalProduct[] | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const archived = brand.status === "ARCHIVED";
  const count = products?.length ?? brand.productCount;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${CATALOG_API}/global-products?brandId=${brand.id}&archived=1`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const parsed = GlobalProductListResponseSchema.safeParse(await res.json());
        if (alive) setProducts(parsed.success ? parsed.data.items : []);
      } catch {
        if (alive) setProducts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, brand.id, brand.version]);

  const putProduct = (p: GlobalProduct, message: string) => {
    setProducts((list) =>
      list?.some((x) => x.id === p.id)
        ? list.map((x) => (x.id === p.id ? p : x))
        : [...(list ?? []), p],
    );
    notify?.(message, "success");
  };

  async function setArchived(archive: boolean) {
    if (
      archive &&
      !window.confirm(
        `Archive ${brand.name}? Its products can no longer be cross-referenced or shown, and verified cross-references to them become stale.`,
      )
    )
      return;
    const r = await callCatalog<{ brand: GlobalBrand }>(
      "POST",
      `/global-brands/${brand.id}/${archive ? "archive" : "restore"}`,
      { version: brand.version },
    );
    if (!r.ok) {
      notify?.(r.message, "error");
      router.refresh();
      return;
    }
    onChange(r.data.brand, archive ? "Brand archived." : "Brand restored.");
  }

  return (
    <li
      aria-labelledby={`${id}-t`}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-raised"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-t`} className="text-base font-semibold text-ink">
              {brand.name}
            </h3>
            {archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
          </div>
          <p className="text-sm text-ink-3">
            {brand.manufacturer}
            {brand.country ? ` · ${brand.country}` : ""} · {count}{" "}
            {count === 1 ? "product" : "products"}
          </p>
          {brand.notes ? <p className="mt-1 text-sm text-ink-2">{brand.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={buttonStyles.ghost}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="list" size={16} />
            {open ? "Hide products" : "Products"}
          </button>
          {canEdit && !archived ? (
            <button type="button" className={buttonStyles.ghost} onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} />
              Edit
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={buttonStyles.ghost}
              onClick={() => void setArchived(!archived)}
            >
              <Icon name={archived ? "refresh" : "archive"} size={16} />
              {archived ? "Restore" : "Archive"}
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="border-t border-line p-4">
          <BrandForm
            initial={{
              name: brand.name,
              manufacturer: brand.manufacturer,
              country: brand.country ?? "",
              notes: brand.notes ?? "",
            }}
            submitLabel="Save brand"
            onCancel={() => setEditing(false)}
            onSubmit={async (d) => {
              const r = await callCatalog<{ brand: GlobalBrand }>(
                "POST",
                `/global-brands/${brand.id}`,
                { ...d, version: brand.version },
              );
              if (!r.ok) return r.message;
              setEditing(false);
              onChange(r.data.brand, "Brand saved.");
              return null;
            }}
          />
        </div>
      ) : null}
      {open ? (
        <div className="space-y-3 border-t border-line bg-surface-2/50 p-4">
          {products === null ? (
            <p className="text-sm text-ink-3">Loading…</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-ink-3">No products of this brand yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {products.map((p) => (
                <ProductRow key={p.id} p={p} canEdit={canEdit && !archived} onChange={putProduct} />
              ))}
            </ul>
          )}
          {canEdit && !archived ? (
            addingProduct ? (
              <ProductForm
                submitLabel="Add product"
                onCancel={() => setAddingProduct(false)}
                onSubmit={async (d) => {
                  const r = await callCatalog<{ product: GlobalProduct }>(
                    "POST",
                    `/global-brands/${brand.id}/products`,
                    d,
                  );
                  if (!r.ok) return r.message;
                  setAddingProduct(false);
                  putProduct(r.data.product, `${r.data.product.name} added.`);
                  return null;
                }}
              />
            ) : (
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={() => setAddingProduct(true)}
              >
                <Icon name="plus" size={16} />
                Add product
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ProductForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; grade: string; description: string };
  submitLabel: string;
  onSubmit: (d: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [d, setD] = useState(initial ?? { name: "", grade: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(
          await onSubmit({
            name: d.name,
            grade: d.grade || null,
            description: d.description || null,
          }),
        );
        setBusy(false);
      }}
      className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2"
    >
      <Field label="Product name" htmlFor={`${id}-n`}>
        <input
          id={`${id}-n`}
          className={FIELD}
          required
          maxLength={GLOBAL_PRODUCT_NAME_MAX}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </Field>
      <Field label="Grade" htmlFor={`${id}-g`} hint="e.g. SAE 5W-30, ISO VG 46, Group III.">
        <input
          id={`${id}-g`}
          className={FIELD}
          maxLength={GLOBAL_GRADE_MAX}
          value={d.grade}
          onChange={(e) => setD({ ...d, grade: e.target.value })}
        />
      </Field>
      <Field label="Description (internal)" htmlFor={`${id}-d`} className="sm:col-span-2">
        <textarea
          id={`${id}-d`}
          className={cx(TEXTAREA, "min-h-20")}
          maxLength={GLOBAL_NOTES_MAX}
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
        />
      </Field>
      {error ? (
        <div className="sm:col-span-2">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={buttonStyles.primary} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function ProductRow({
  p,
  canEdit,
  onChange,
}: {
  p: GlobalProduct;
  canEdit: boolean;
  onChange: (p: GlobalProduct, message: string) => void;
}) {
  const notify = useNotice();
  const [editing, setEditing] = useState(false);
  const archived = p.status === "ARCHIVED";
  async function setArchived(archive: boolean) {
    const r = await callCatalog<{ product: GlobalProduct }>(
      "POST",
      `/global-products/${p.id}/${archive ? "archive" : "restore"}`,
      { version: p.version },
    );
    if (!r.ok) {
      notify?.(r.message, "error");
      return;
    }
    onChange(r.data.product, archive ? "Product archived." : "Product restored.");
  }
  if (editing) {
    return (
      <li className="p-3">
        <ProductForm
          initial={{ name: p.name, grade: p.grade ?? "", description: p.description ?? "" }}
          submitLabel="Save product"
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            const r = await callCatalog<{ product: GlobalProduct }>(
              "POST",
              `/global-products/${p.id}`,
              { ...d, version: p.version },
            );
            if (!r.ok) return r.message;
            setEditing(false);
            onChange(
              r.data.product,
              "Product saved. Verified cross-references to it need a new verification.",
            );
            return null;
          }}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {p.name}
          {p.grade ? <span className="font-normal text-ink-3">· {p.grade}</span> : null}
          {archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
        </span>
        {p.description ? <span className="block text-xs text-ink-3">{p.description}</span> : null}
      </span>
      {canEdit ? (
        <span className="flex shrink-0 gap-1">
          {!archived ? (
            <button type="button" className={buttonStyles.ghost} onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} />
              Edit
            </button>
          ) : null}
          <button
            type="button"
            className={buttonStyles.ghost}
            onClick={() => void setArchived(!archived)}
          >
            {archived ? "Restore" : "Archive"}
          </button>
        </span>
      ) : null}
    </li>
  );
}
