"use client";

/**
 * The form of a set of CMS field descriptors (S1/S2, ADR-020 D2): text, link, list, group and
 * registered asset fields. Shared by the section editor of TEMPLATE pages and the editor of
 * designed pages and fragments. A form description, not a page builder: no drag and drop, no
 * layout; lists reorder with buttons.
 */
import { CMS_STATIC_ASSETS, type CmsField } from "@dream/contracts";
import type { ReactNode } from "react";
import { Field, FIELD, TEXTAREA } from "../catalog/parts";
import { Icon } from "../icons";
import { buttonStyles, cx } from "../ui";

export type Value = string | LinkValue | ItemValue[] | ItemValue | null;
export interface LinkValue {
  label: string;
  href: string;
}
export type ItemValue = { [key: string]: Value };

/** Form values of a set of fields, from stored content (or empty). */
export function toValues(fields: readonly CmsField[], source: Record<string, unknown>): ItemValue {
  const out: ItemValue = {};
  for (const f of fields) {
    const v = source[f.key];
    switch (f.type) {
      case "text":
      case "asset":
        out[f.key] = typeof v === "string" ? v : "";
        break;
      case "link": {
        const link = v as Partial<LinkValue> | null | undefined;
        out[f.key] = { label: link?.label ?? "", href: link?.href ?? "" };
        break;
      }
      case "group":
        out[f.key] = toValues(f.fields, (v as Record<string, unknown> | null) ?? {});
        break;
      case "list": {
        const items = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
        out[f.key] = (items.length ? items : Array.from({ length: f.min }, () => ({}))).map(
          (item) => toValues(f.fields, item),
        );
        break;
      }
    }
  }
  return out;
}

/** Request content of a set of fields: blank optional links and link targets become null. */
export function toContent(fields: readonly CmsField[], values: ItemValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    switch (f.type) {
      case "text":
        out[f.key] =
          f.format === "href" && (typeof v !== "string" || !v.trim())
            ? null
            : typeof v === "string"
              ? v
              : "";
        break;
      case "asset":
        out[f.key] = typeof v === "string" ? v : "";
        break;
      case "link": {
        const link = (v as LinkValue | null) ?? { label: "", href: "" };
        out[f.key] = !f.required && !link.label.trim() && !link.href.trim() ? null : link;
        break;
      }
      case "group":
        out[f.key] = toContent(f.fields, (v as ItemValue | null) ?? {});
        break;
      case "list":
        out[f.key] = ((v as ItemValue[]) ?? []).map((item) => toContent(f.fields, item));
        break;
    }
  }
  return out;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function Fields({
  fields,
  values,
  path,
  idPrefix,
  readOnly,
  invalid,
  onChange,
  site = "BV",
}: {
  fields: readonly CmsField[];
  values: ItemValue;
  path: string;
  idPrefix: string;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  onChange: (values: ItemValue) => void;
  site?: "BV" | "CORPORATE";
}) {
  const set = (key: string, v: Value) => onChange({ ...values, [key]: v });
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const fieldPath = `${path}.${f.key}`;
        if (f.type === "text") {
          const v = (values[f.key] as string) ?? "";
          const optional = !f.required && !f.format;
          const hint =
            f.hint ??
            (f.format === "href"
              ? "Optional. /page, #section, https://…, mailto: or tel:"
              : f.multiline
                ? `${v.length}/${f.max}`
                : undefined);
          return (
            <Field
              key={f.key}
              label={optional ? `${f.label} (optional)` : f.label}
              htmlFor={id}
              hint={hint}
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
                  spellCheck={f.format ? false : undefined}
                  aria-invalid={invalid(fieldPath)}
                  onChange={(e) => set(f.key, e.currentTarget.value)}
                  className={cx(FIELD, f.format ? "font-mono text-sm" : undefined)}
                />
              )}
            </Field>
          );
        }
        if (f.type === "asset") {
          const v = (values[f.key] as string) ?? "";
          const options = CMS_STATIC_ASSETS.filter(
            (a) => a.site === site && f.kinds.includes(a.kind),
          );
          const chosen = options.find((a) => a.src === v);
          return (
            <Field
              key={f.key}
              label={f.label}
              htmlFor={id}
              hint={
                f.hint ??
                (chosen
                  ? `${chosen.width} × ${chosen.height} px · registered site asset`
                  : "Choose a registered site asset (uploads arrive with the media library).")
              }
            >
              <select
                id={id}
                value={v}
                disabled={readOnly}
                aria-invalid={invalid(fieldPath)}
                onChange={(e) => set(f.key, e.currentTarget.value)}
                className={cx(FIELD, "font-mono text-sm")}
              >
                {!chosen ? <option value={v}>{v || "Choose…"}</option> : null}
                {options.map((a) => (
                  <option key={a.src} value={a.src}>
                    {a.src.replace(/^\/media\//, "")}
                  </option>
                ))}
              </select>
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
        if (f.type === "group") {
          const v = (values[f.key] as ItemValue | null) ?? {};
          return (
            <fieldset
              key={f.key}
              className={cx(
                "space-y-3 rounded-lg border p-3",
                invalid(fieldPath) ? "border-danger/50" : "border-line",
              )}
            >
              <legend className="px-1 text-sm font-medium text-ink">{f.label}</legend>
              {f.hint ? <p className="text-xs text-ink-3">{f.hint}</p> : null}
              <Fields
                fields={f.fields}
                values={v}
                path={fieldPath}
                idPrefix={id}
                readOnly={readOnly}
                invalid={invalid}
                onChange={(next) => set(f.key, next)}
                site={site}
              />
            </fieldset>
          );
        }
        const items = (values[f.key] as ItemValue[]) ?? [];
        const setItems = (next: ItemValue[]) => set(f.key, next);
        const fixed = f.min === f.max;
        return (
          <fieldset key={f.key} className="space-y-3">
            <legend className="text-sm font-medium text-ink">
              {f.label}{" "}
              <span className="font-normal text-ink-3">
                ({items.length}
                {fixed ? `, exactly ${f.min}` : `, ${f.min}–${f.max}`})
              </span>
            </legend>
            {f.hint ? <p className="text-xs text-ink-3">{f.hint}</p> : null}
            <ol className="space-y-3">
              {items.map((item, j) => (
                <li
                  key={j}
                  className={cx(
                    "rounded-lg border bg-surface-2/50 p-3",
                    invalid(`${fieldPath}.${j}`) ? "border-danger/50" : "border-line",
                  )}
                >
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
                        {!fixed ? (
                          <IconButton
                            label={`Remove ${f.itemLabel.toLowerCase()} ${j + 1}`}
                            disabled={items.length <= f.min}
                            onClick={() => setItems(items.filter((_, k) => k !== j))}
                          >
                            <Icon name="trash" size={15} />
                          </IconButton>
                        ) : null}
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
                      site={site}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {!readOnly && !fixed ? (
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

export function IconButton({
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
