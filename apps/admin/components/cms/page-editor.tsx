"use client";

import {
  CMS_SECTION_TYPES,
  CMS_SECTIONS_MAX,
  type CmsField,
  type CmsPage,
  type CmsPageDraftRequest,
  type CmsPageResponse,
  type CmsSectionType,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { callCms, type FieldIssue } from "../../lib/cms-client";
import { Field, FIELD, FormMessage, TEXTAREA } from "../catalog/parts";
import { useNotice } from "../catalog/notices";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, Spinner } from "../ui";

type Value = string | LinkValue | ItemValue[] | null;
interface LinkValue {
  label: string;
  href: string;
}
type ItemValue = Record<string, Value>;
interface SectionValue {
  id: string;
  type: string;
  values: Record<string, Value>;
}

const SECTION_BY_TYPE = new Map(CMS_SECTION_TYPES.map((s) => [s.type, s]));

function newSectionId(): string {
  return `sec-${crypto.randomUUID().slice(0, 8)}`;
}

/** Form values of a set of fields, from stored content (or empty). */
function toValues(
  fields: readonly CmsField[],
  source: Record<string, unknown>,
): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const f of fields) {
    const v = source[f.key];
    if (f.type === "text") out[f.key] = typeof v === "string" ? v : "";
    else if (f.type === "link") {
      const link = v as Partial<LinkValue> | null | undefined;
      out[f.key] = { label: link?.label ?? "", href: link?.href ?? "" };
    } else {
      const items = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
      out[f.key] = (items.length ? items : Array.from({ length: f.min }, () => ({}))).map((item) =>
        toValues(f.fields, item),
      );
    }
  }
  return out;
}

/** Request content of a set of fields: blank optional links are left out (null). */
function toContent(
  fields: readonly CmsField[],
  values: Record<string, Value>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === "text") out[f.key] = typeof v === "string" ? v : "";
    else if (f.type === "link") {
      const link = (v as LinkValue | null) ?? { label: "", href: "" };
      out[f.key] = !f.required && !link.label.trim() && !link.href.trim() ? null : link;
    } else out[f.key] = ((v as ItemValue[]) ?? []).map((item) => toContent(f.fields, item));
  }
  return out;
}

function fromPage(page: CmsPage): SectionValue[] {
  return page.content.sections.map((s) => {
    const def = SECTION_BY_TYPE.get(s.type);
    return { id: s.id, type: s.type, values: def ? toValues(def.fields, s) : {} };
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * The draft editor of a TEMPLATE page (S1, DP-015): page details, SEO and the ordered sections,
 * each a form generated from the contracts field descriptors (not a page builder: layouts stay in
 * the site's code). Saving replaces the whole draft and names the version it was based on.
 */
export function PageEditor({
  page,
  canEdit,
  siteLabel,
}: {
  page: CmsPage;
  canEdit: boolean;
  siteLabel: string;
}) {
  const router = useRouter();
  const notify = useNotice();
  const readOnly = !canEdit;
  const [version, setVersion] = useState(page.version);
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug ?? "");
  const [seoTitle, setSeoTitle] = useState(page.seo.title ?? "");
  const [seoDescription, setSeoDescription] = useState(page.seo.description ?? "");
  const [noindex, setNoindex] = useState(page.seo.noindex);
  const [sections, setSections] = useState<SectionValue[]>(() => fromPage(page));
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const invalid = useMemo(() => {
    const paths = issues.map((i) => i.path);
    return (path: string) => paths.some((p) => p === path || p.startsWith(`${path}.`)) || undefined;
  }, [issues]);

  function change<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }
  const updateSections = change(setSections);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const body: CmsPageDraftRequest = {
      version,
      title,
      slug,
      seo: { title: seoTitle, description: seoDescription, noindex },
      content: {
        sections: sections.map((s) => {
          const def = SECTION_BY_TYPE.get(s.type);
          return { id: s.id, type: s.type, ...(def ? toContent(def.fields, s.values) : {}) };
        }),
      },
    };
    setPending(true);
    setError(null);
    setIssues([]);
    const result = await callCms<CmsPageResponse>(`/pages/${page.id}/draft`, body);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setIssues(result.issues);
      return;
    }
    setVersion(result.data.page.version);
    setDirty(false);
    if (notify) notify("Draft saved.");
    router.refresh();
  }

  const sectionCount = sections.length;

  return (
    <form
      onSubmit={save}
      noValidate
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="min-w-0 space-y-6">
        <Panel id="page-details" title="Page" description={`On ${siteLabel}, in ${page.locale}.`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Page title" htmlFor="title">
              <input
                id="title"
                required
                maxLength={200}
                value={title}
                readOnly={readOnly}
                aria-invalid={invalid("title")}
                onChange={(e) => change(setTitle)(e.currentTarget.value)}
                className={FIELD}
              />
            </Field>
            <Field label="Address" htmlFor="slug" hint="Changing it changes the page URL.">
              <div className="flex items-center">
                <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-line-strong bg-surface-2 px-3 font-mono text-sm text-ink-3">
                  /
                </span>
                <input
                  id="slug"
                  required
                  maxLength={80}
                  value={slug}
                  readOnly={readOnly}
                  spellCheck={false}
                  aria-invalid={invalid("slug")}
                  onChange={(e) => change(setSlug)(e.currentTarget.value)}
                  className={cx(FIELD, "rounded-l-none font-mono")}
                />
              </div>
            </Field>
          </div>
        </Panel>

        <Panel
          id="sections"
          title="Sections"
          description={`${sectionCount} of at most ${CMS_SECTIONS_MAX}. Shown on the page in this order.`}
        >
          {sections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">
              No sections yet. Add the first one below; a page usually opens with a hero.
            </p>
          ) : (
            <ol className="space-y-4">
              {sections.map((s, i) => (
                <SectionCard
                  key={s.id}
                  index={i}
                  count={sections.length}
                  section={s}
                  readOnly={readOnly}
                  invalid={invalid}
                  onChange={(values) =>
                    updateSections(sections.map((x) => (x.id === s.id ? { ...x, values } : x)))
                  }
                  onMove={(to) => updateSections(move(sections, i, to))}
                  onRemove={() => updateSections(sections.filter((x) => x.id !== s.id))}
                />
              ))}
            </ol>
          )}
          {!readOnly ? (
            <AddSection
              disabled={sections.length >= CMS_SECTIONS_MAX}
              onAdd={(def) =>
                updateSections([
                  ...sections,
                  { id: newSectionId(), type: def.type, values: toValues(def.fields, {}) },
                ])
              }
            />
          ) : null}
        </Panel>
      </div>

      <div className="space-y-6 lg:sticky lg:top-6">
        <Panel id="draft" title="Draft">
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">
              Version {version}
              {dirty ? (
                <span className="ml-2 font-medium text-amber-ink">· unsaved changes</span>
              ) : null}
            </p>
            <p className="text-ink-3">
              Saving keeps the draft in the CMS. Preview and publishing arrive in the next release;
              the public site does not change.
            </p>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            {!readOnly ? (
              <button
                type="submit"
                disabled={pending}
                className={cx(buttonStyles.primary, "w-full")}
              >
                {pending ? <Spinner /> : <Icon name="check" size={17} />}
                Save draft
              </button>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
                Read only for you on this site.
              </p>
            )}
          </div>
        </Panel>

        <Panel id="seo" title="SEO" description="Search results and link previews.">
          <div className="space-y-4">
            <Field
              label="SEO title"
              htmlFor="seo-title"
              hint={`${seoTitle.length}/120 · about 60 characters show in results. Empty: the page title.`}
            >
              <input
                id="seo-title"
                maxLength={120}
                value={seoTitle}
                readOnly={readOnly}
                aria-invalid={invalid("seo.title")}
                onChange={(e) => change(setSeoTitle)(e.currentTarget.value)}
                className={FIELD}
              />
            </Field>
            <Field
              label="Meta description"
              htmlFor="seo-description"
              hint={`${seoDescription.length}/320 · about 155 characters show in results.`}
            >
              <textarea
                id="seo-description"
                maxLength={320}
                rows={4}
                value={seoDescription}
                readOnly={readOnly}
                aria-invalid={invalid("seo.description")}
                onChange={(e) => change(setSeoDescription)(e.currentTarget.value)}
                className={TEXTAREA}
              />
            </Field>
            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={noindex}
                disabled={readOnly}
                onChange={(e) => change(setNoindex)(e.currentTarget.checked)}
                className="mt-0.5 size-4 accent-petrol"
              />
              <span>
                Hide from search engines
                <span className="block text-xs text-ink-3">
                  Adds noindex when the page is published.
                </span>
              </span>
            </label>
          </div>
        </Panel>
      </div>
    </form>
  );
}

function SectionCard({
  index,
  count,
  section,
  readOnly,
  invalid,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  section: SectionValue;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  onChange: (values: Record<string, Value>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const def = SECTION_BY_TYPE.get(section.type);
  const path = `content.sections.${index}`;
  const headingId = `${section.id}-heading`;
  return (
    <li
      aria-labelledby={headingId}
      className={cx(
        "rounded-xl border bg-surface",
        invalid(path) ? "border-danger/50" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="tabular inline-flex size-6 items-center justify-center rounded-md bg-surface-2 text-xs text-ink-2">
            {index + 1}
          </span>
          {def?.label ?? section.type}
        </h3>
        {!readOnly ? (
          <div className="flex items-center gap-1">
            <IconButton
              label={`Move section ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            >
              <Icon name="chevron" size={16} className="-rotate-90" />
            </IconButton>
            <IconButton
              label={`Move section ${index + 1} down`}
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              <Icon name="chevron" size={16} className="rotate-90" />
            </IconButton>
            <IconButton label={`Remove section ${index + 1}`} onClick={onRemove}>
              <Icon name="trash" size={16} />
            </IconButton>
          </div>
        ) : null}
      </div>
      <div className="space-y-4 p-4">
        {def ? (
          <Fields
            fields={def.fields}
            values={section.values}
            path={path}
            idPrefix={section.id}
            readOnly={readOnly}
            invalid={invalid}
            onChange={onChange}
          />
        ) : (
          <p className="text-sm text-danger">Unknown section type. Remove it to save the page.</p>
        )}
      </div>
    </li>
  );
}

function Fields({
  fields,
  values,
  path,
  idPrefix,
  readOnly,
  invalid,
  onChange,
}: {
  fields: readonly CmsField[];
  values: Record<string, Value>;
  path: string;
  idPrefix: string;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  onChange: (values: Record<string, Value>) => void;
}) {
  const set = (key: string, v: Value) => onChange({ ...values, [key]: v });
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const fieldPath = `${path}.${f.key}`;
        if (f.type === "text") {
          const v = (values[f.key] as string) ?? "";
          return (
            <Field
              key={f.key}
              label={f.required ? f.label : `${f.label} (optional)`}
              htmlFor={id}
              hint={f.hint ?? (f.multiline ? `${v.length}/${f.max}` : undefined)}
            >
              {f.multiline ? (
                <textarea
                  id={id}
                  maxLength={f.max}
                  rows={f.max > 1000 ? 8 : 3}
                  value={v}
                  readOnly={readOnly}
                  aria-invalid={invalid(fieldPath)}
                  onChange={(e) => set(f.key, e.currentTarget.value)}
                  className={TEXTAREA}
                />
              ) : (
                <input
                  id={id}
                  maxLength={f.max}
                  value={v}
                  readOnly={readOnly}
                  aria-invalid={invalid(fieldPath)}
                  onChange={(e) => set(f.key, e.currentTarget.value)}
                  className={FIELD}
                />
              )}
            </Field>
          );
        }
        if (f.type === "link") {
          const v = (values[f.key] as LinkValue | null) ?? { label: "", href: "" };
          return (
            <fieldset key={f.key} className="rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">
                {f.required ? f.label : `${f.label} (optional)`}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
                <Field label="Label" htmlFor={`${id}-label`}>
                  <input
                    id={`${id}-label`}
                    maxLength={80}
                    value={v.label}
                    readOnly={readOnly}
                    aria-invalid={
                      invalid(`${fieldPath}.label`) ??
                      (invalid(fieldPath) && !v.label ? true : undefined)
                    }
                    onChange={(e) => set(f.key, { ...v, label: e.currentTarget.value })}
                    className={FIELD}
                  />
                </Field>
                <Field
                  label="Link"
                  htmlFor={`${id}-href`}
                  hint="/page, #section, https://…, mailto: or tel:"
                >
                  <input
                    id={`${id}-href`}
                    maxLength={500}
                    value={v.href}
                    readOnly={readOnly}
                    spellCheck={false}
                    aria-invalid={
                      invalid(`${fieldPath}.href`) ??
                      (invalid(fieldPath) && !v.href ? true : undefined)
                    }
                    onChange={(e) => set(f.key, { ...v, href: e.currentTarget.value })}
                    className={cx(FIELD, "font-mono text-sm")}
                  />
                </Field>
              </div>
            </fieldset>
          );
        }
        const items = (values[f.key] as ItemValue[]) ?? [];
        const setItems = (next: ItemValue[]) => set(f.key, next);
        return (
          <fieldset key={f.key} className="space-y-3">
            <legend className="text-sm font-medium text-ink">
              {f.label}{" "}
              <span className="font-normal text-ink-3">
                ({items.length}, {f.min}–{f.max})
              </span>
            </legend>
            <ol className="space-y-3">
              {items.map((item, j) => (
                <li key={j} className="rounded-lg border border-line bg-surface-2/50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                      {f.itemLabel} {j + 1}
                    </span>
                    {!readOnly ? (
                      <div className="flex items-center gap-1">
                        <IconButton
                          label={`Move ${f.itemLabel.toLowerCase()} ${j + 1} up`}
                          disabled={j === 0}
                          onClick={() => setItems(move(items, j, j - 1))}
                        >
                          <Icon name="chevron" size={15} className="-rotate-90" />
                        </IconButton>
                        <IconButton
                          label={`Move ${f.itemLabel.toLowerCase()} ${j + 1} down`}
                          disabled={j === items.length - 1}
                          onClick={() => setItems(move(items, j, j + 1))}
                        >
                          <Icon name="chevron" size={15} className="rotate-90" />
                        </IconButton>
                        <IconButton
                          label={`Remove ${f.itemLabel.toLowerCase()} ${j + 1}`}
                          disabled={items.length <= f.min}
                          onClick={() => setItems(items.filter((_, k) => k !== j))}
                        >
                          <Icon name="trash" size={15} />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    <Fields
                      fields={f.fields}
                      values={item}
                      path={`${fieldPath}.${j}`}
                      idPrefix={`${id}-${j}`}
                      readOnly={readOnly}
                      invalid={invalid}
                      onChange={(v) => setItems(items.map((x, k) => (k === j ? v : x)))}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {!readOnly ? (
              <button
                type="button"
                disabled={items.length >= f.max}
                onClick={() => setItems([...items, toValues(f.fields, {})])}
                className={buttonStyles.secondary}
              >
                <Icon name="plus" size={16} />
                Add {f.itemLabel.toLowerCase()}
              </button>
            ) : null}
          </fieldset>
        );
      })}
    </>
  );
}

function AddSection({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (def: CmsSectionType) => void;
}) {
  const id = useId();
  return (
    <div className="mt-5 border-t border-line pt-4" role="group" aria-labelledby={id}>
      <p id={id} className="mb-3 text-sm font-medium text-ink">
        Add a section
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CMS_SECTION_TYPES.map((def) => (
          <button
            key={def.type}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(def)}
            className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface p-3 text-left transition-colors hover:border-petrol hover:bg-petrol-soft/40 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-petrol-soft text-petrol-strong">
              <Icon name="plus" size={15} />
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">{def.label}</span>
              <span className="block text-xs text-ink-3">{def.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(buttonStyles.icon, "size-8")}
    >
      {children}
    </button>
  );
}
