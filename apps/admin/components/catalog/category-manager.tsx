"use client";

import {
  CATEGORY_MAX_DEPTH,
  type Category,
  type CategoryCreateRequest,
  type CategoryUpdateRequest,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { flattenTree, type TreeRow } from "../../lib/catalog-view";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill } from "../ui";
import { Field, FIELD, FormMessage } from "./parts";
import { slugify } from "./product-master-form";

/** Ids of a category and everything below it: not offered as its new parent. */
function subtree(items: readonly Category[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of items) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

function CategoryFields({
  idPrefix,
  category,
  rows,
  excluded,
  issues,
}: {
  idPrefix: string;
  category: Category | null;
  rows: readonly TreeRow[];
  excluded: ReadonlySet<string>;
  issues: readonly FieldIssue[];
}) {
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [touched, setTouched] = useState(Boolean(category));
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${idPrefix}-name`}>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={120}
          defaultValue={category?.name}
          aria-invalid={invalid("name")}
          onChange={(e) => {
            if (!touched) setSlug(slugify(e.currentTarget.value));
          }}
          className={FIELD}
        />
      </Field>
      <Field label="Slug" htmlFor={`${idPrefix}-slug`} hint="Unique on this site.">
        <input
          id={`${idPrefix}-slug`}
          name="slug"
          required
          maxLength={120}
          value={slug}
          spellCheck={false}
          aria-invalid={invalid("slug")}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.currentTarget.value);
          }}
          className={cx(FIELD, "font-mono")}
        />
      </Field>
      <Field
        label="Parent"
        htmlFor={`${idPrefix}-parent`}
        hint={`At most ${CATEGORY_MAX_DEPTH} levels.`}
      >
        <select
          id={`${idPrefix}-parent`}
          name="parentId"
          defaultValue={category?.parentId ?? ""}
          aria-invalid={invalid("parentId")}
          className={FIELD}
        >
          <option value="">None (top level)</option>
          {rows
            .filter(
              ({ category: c, depth }) => !excluded.has(c.id) && depth < CATEGORY_MAX_DEPTH - 1,
            )
            .map(({ category: c, depth }) => (
              <option key={c.id} value={c.id}>
                {" ".repeat(depth)}
                {c.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Sort order" htmlFor={`${idPrefix}-sort`}>
        <input
          id={`${idPrefix}-sort`}
          name="sortOrder"
          type="number"
          step={1}
          inputMode="numeric"
          defaultValue={category?.sortOrder ?? 0}
          className={cx(FIELD, "tabular")}
        />
      </Field>
      <Field label="Description" htmlFor={`${idPrefix}-description`} className="sm:col-span-2">
        <input
          id={`${idPrefix}-description`}
          name="description"
          maxLength={1000}
          defaultValue={category?.description ?? ""}
          className={FIELD}
        />
      </Field>
    </div>
  );
}

function readForm(form: HTMLFormElement): CategoryCreateRequest {
  const data = new FormData(form);
  const parent = String(data.get("parentId") ?? "");
  return {
    name: String(data.get("name") ?? ""),
    slug: String(data.get("slug") ?? ""),
    parentId: parent || null,
    description: String(data.get("description") ?? ""),
    sortOrder: Number.parseInt(String(data.get("sortOrder") ?? "0"), 10) || 0,
  };
}

/** The category tree of one site with create, edit, default and delete (product:edit). */
export function CategoryManager({
  siteId,
  siteName,
  items,
  canEdit,
}: {
  siteId: string;
  siteName: string;
  items: readonly Category[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const rows = flattenTree(items);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  function fail(message: string, list: FieldIssue[] = []) {
    setError(message);
    setIssues(list);
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    const r = await callCatalog<{ category: Category }>(
      "POST",
      `/sites/${siteId}/categories`,
      readForm(e.currentTarget),
    );
    setBusy(null);
    if (!r.ok) return fail(r.message, r.issues);
    setCreating(false);
    setIssues([]);
    router.refresh();
  }

  async function update(e: FormEvent<HTMLFormElement>, c: Category) {
    e.preventDefault();
    setBusy(c.id);
    setError(null);
    const body: CategoryUpdateRequest = { ...readForm(e.currentTarget), version: c.version };
    const r = await callCatalog<{ category: Category }>("POST", `/categories/${c.id}`, body);
    setBusy(null);
    if (!r.ok) return fail(r.message, r.issues);
    setEditing(null);
    setIssues([]);
    router.refresh();
  }

  async function makeDefault(c: Category) {
    setBusy(c.id);
    setError(null);
    const r = await callCatalog("POST", `/categories/${c.id}/default`, { version: c.version });
    setBusy(null);
    if (!r.ok) return fail(r.message, r.issues);
    router.refresh();
  }

  async function remove(c: Category) {
    if (!window.confirm(`Delete the category “${c.name}”? This cannot be undone.`)) return;
    setBusy(c.id);
    setError(null);
    const r = await callCatalog("DELETE", `/categories/${c.id}`);
    setBusy(null);
    if (!r.ok) return fail(r.message, r.issues);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="px-5 sm:px-6">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon="folder" title={`No categories on ${siteName} yet`}>
          {canEdit
            ? "Create the first category. It becomes the site's default for new listings."
            : "A site editor creates the categories of this site."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map(({ category: c, depth }) => {
            const isEditing = editing === c.id;
            return (
              <li key={c.id} className={cx(isEditing && "bg-surface-2/60")}>
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-5 sm:pr-6"
                  style={{ paddingLeft: `calc(1.25rem + ${depth * 1.5}rem)` }}
                >
                  <Icon name="folder" size={17} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{c.name}</span>
                      {c.isDefault ? <StatusPill tone="petrol">Default</StatusPill> : null}
                    </span>
                    <span className="block text-xs text-ink-3">
                      <span className="font-mono">{c.slug}</span> · {c.listingCount} product
                      {c.listingCount === 1 ? "" : "s"}
                      {c.childCount
                        ? ` · ${c.childCount} sub-categor${c.childCount === 1 ? "y" : "ies"}`
                        : ""}
                    </span>
                  </span>
                  {canEdit ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {busy === c.id ? <Spinner /> : null}
                      {!c.isDefault ? (
                        <button
                          type="button"
                          onClick={() => makeDefault(c)}
                          disabled={busy !== null}
                          className={buttonStyles.ghost}
                          title="Use for new listings without a category"
                        >
                          <Icon name="star" size={16} />
                          <span className="hidden sm:inline">Make default</span>
                          <span className="sr-only sm:hidden">Make {c.name} the default</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(isEditing ? null : c.id);
                          setCreating(false);
                          setError(null);
                          setIssues([]);
                        }}
                        aria-expanded={isEditing}
                        className={buttonStyles.ghost}
                      >
                        <Icon name="edit" size={16} />
                        <span className="hidden sm:inline">{isEditing ? "Close" : "Edit"}</span>
                        <span className="sr-only sm:hidden">Edit {c.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        disabled={busy !== null || c.childCount > 0 || c.listingCount > 0}
                        title={
                          c.childCount > 0 || c.listingCount > 0
                            ? "Only empty categories can be deleted"
                            : "Delete"
                        }
                        className={cx(buttonStyles.icon, "hover:text-danger")}
                      >
                        <Icon name="trash" size={16} />
                        <span className="sr-only">Delete {c.name}</span>
                      </button>
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <form
                    onSubmit={(e) => update(e, c)}
                    noValidate
                    className="space-y-3 px-5 pb-4 sm:px-6"
                    style={{ paddingLeft: `calc(1.25rem + ${depth * 1.5}rem)` }}
                  >
                    <CategoryFields
                      idPrefix={`edit-${c.id}`}
                      category={c}
                      rows={rows}
                      excluded={subtree(items, c.id)}
                      issues={issues}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className={buttonStyles.secondary}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={busy !== null}
                        className={buttonStyles.primary}
                      >
                        {busy === c.id ? <Spinner /> : null}
                        Save category
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <div className="px-5 sm:px-6">
          {creating ? (
            <form
              onSubmit={create}
              noValidate
              className="space-y-3 rounded-xl border border-line p-4"
            >
              <h3 className="text-sm font-semibold text-ink">New category on {siteName}</h3>
              <CategoryFields
                idPrefix="new"
                category={null}
                rows={rows}
                excluded={new Set()}
                issues={issues}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className={buttonStyles.secondary}
                >
                  Cancel
                </button>
                <button type="submit" disabled={busy !== null} className={buttonStyles.primary}>
                  {busy === "create" ? <Spinner /> : <Icon name="plus" size={17} />}
                  Create category
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setError(null);
                setIssues([]);
              }}
              className={buttonStyles.secondary}
            >
              <Icon name="plus" size={17} />
              New category
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
