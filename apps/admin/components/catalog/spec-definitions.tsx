"use client";

import {
  SPEC_DATA_TYPES,
  type SpecDataType,
  type SpecDefinition,
  type SpecDefinitionCreateRequest,
  type SpecDefinitionUpdateRequest,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill } from "../ui";
import { Field, FIELD, FormMessage } from "./parts";
import { useNotice } from "./notices";

const TYPE_LABEL: Record<SpecDataType, string> = {
  NUMBER: "Number",
  RANGE: "Range (min–max)",
  TEXT: "Text",
  BOOLEAN: "Yes / no",
};

/** "mm²/s, cSt" -> ["mm²/s", "cSt"] (trimmed, empty parts dropped). */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  // An invalid entry is sent as typed, so the API names the field instead of JSON turning NaN
  // into a silent null.
  return Number.isFinite(n) ? n : (s as unknown as number);
}

function readDefinition(
  form: HTMLFormElement,
  dataType: SpecDataType,
): SpecDefinitionCreateRequest {
  const d = new FormData(form);
  const numeric = dataType === "NUMBER" || dataType === "RANGE";
  return {
    key: String(d.get("key") ?? ""),
    name: String(d.get("name") ?? ""),
    dataType,
    units: numeric ? splitList(String(d.get("units") ?? "")) : [],
    testMethods: splitList(String(d.get("testMethods") ?? "")),
    required: d.get("required") === "on",
    minValue: numeric ? optionalNumber(d.get("minValue")) : null,
    maxValue: numeric ? optionalNumber(d.get("maxValue")) : null,
    decimals: numeric ? optionalNumber(d.get("decimals")) : null,
    maxLength: dataType === "TEXT" ? optionalNumber(d.get("maxLength")) : null,
    sortOrder: Number.parseInt(String(d.get("sortOrder") ?? "0"), 10) || 0,
  };
}

function DefinitionFields({
  prefix,
  def,
  dataType,
  onType,
  issues,
}: {
  prefix: string;
  def: SpecDefinition | null;
  dataType: SpecDataType;
  onType?: (t: SpecDataType) => void;
  issues: readonly FieldIssue[];
}) {
  const invalid = (p: string) => issues.some((i) => i.path === p) || undefined;
  const numeric = dataType === "NUMBER" || dataType === "RANGE";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Name" htmlFor={`${prefix}-name`} className="sm:col-span-2">
        <input
          id={`${prefix}-name`}
          name="name"
          required
          maxLength={120}
          defaultValue={def?.name}
          aria-invalid={invalid("name")}
          className={FIELD}
        />
      </Field>
      <Field
        label="Key"
        htmlFor={`${prefix}-key`}
        hint={def ? "Cannot change." : "snake_case, unique."}
      >
        <input
          id={`${prefix}-key`}
          name="key"
          required
          maxLength={64}
          defaultValue={def?.key}
          readOnly={Boolean(def)}
          spellCheck={false}
          aria-invalid={invalid("key")}
          className={cx(FIELD, "font-mono")}
        />
      </Field>
      <Field label="Data type" htmlFor={`${prefix}-type`} hint={def ? "Cannot change." : undefined}>
        <select
          id={`${prefix}-type`}
          value={dataType}
          disabled={Boolean(def)}
          onChange={(e) => onType?.(e.currentTarget.value as SpecDataType)}
          className={FIELD}
        >
          {SPEC_DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      {numeric ? (
        <>
          <Field
            label="Units"
            htmlFor={`${prefix}-units`}
            hint="Comma separated; first is the default."
            className="sm:col-span-2"
          >
            <input
              id={`${prefix}-units`}
              name="units"
              defaultValue={def?.units.join(", ")}
              aria-invalid={invalid("units")}
              className={FIELD}
            />
          </Field>
          <Field label="Minimum" htmlFor={`${prefix}-min`}>
            <input
              id={`${prefix}-min`}
              name="minValue"
              inputMode="decimal"
              defaultValue={def?.minValue ?? ""}
              aria-invalid={invalid("minValue")}
              className={cx(FIELD, "tabular")}
            />
          </Field>
          <Field label="Maximum" htmlFor={`${prefix}-max`}>
            <input
              id={`${prefix}-max`}
              name="maxValue"
              inputMode="decimal"
              defaultValue={def?.maxValue ?? ""}
              aria-invalid={invalid("maxValue")}
              className={cx(FIELD, "tabular")}
            />
          </Field>
          <Field label="Decimals" htmlFor={`${prefix}-dec`} hint="0–6, empty: any.">
            <input
              id={`${prefix}-dec`}
              name="decimals"
              inputMode="numeric"
              defaultValue={def?.decimals ?? ""}
              aria-invalid={invalid("decimals")}
              className={cx(FIELD, "tabular")}
            />
          </Field>
        </>
      ) : null}
      {dataType === "TEXT" ? (
        <Field label="Max length" htmlFor={`${prefix}-len`}>
          <input
            id={`${prefix}-len`}
            name="maxLength"
            inputMode="numeric"
            defaultValue={def?.maxLength ?? ""}
            aria-invalid={invalid("maxLength")}
            className={cx(FIELD, "tabular")}
          />
        </Field>
      ) : null}
      <Field
        label="Test methods"
        htmlFor={`${prefix}-methods`}
        hint="Recommended, comma separated (e.g. ASTM D445, ISO 3104)."
        className="sm:col-span-2"
      >
        <input
          id={`${prefix}-methods`}
          name="testMethods"
          defaultValue={def?.testMethods.join(", ")}
          aria-invalid={invalid("testMethods")}
          className={FIELD}
        />
      </Field>
      <Field label="Sort order" htmlFor={`${prefix}-sort`}>
        <input
          id={`${prefix}-sort`}
          name="sortOrder"
          type="number"
          step={1}
          defaultValue={def?.sortOrder ?? 0}
          className={cx(FIELD, "tabular")}
        />
      </Field>
      <div className="flex flex-col justify-end gap-2 pb-2 text-sm text-ink">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="required"
            defaultChecked={def?.required ?? false}
            className="size-4 accent-[var(--petrol)]"
          />
          Required for publication
        </label>
        {def ? (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={def.archived}
              className="size-4 accent-[var(--petrol)]"
            />
            Archived (hidden for new values)
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function SpecDefinitionManager({
  items,
  canEdit,
}: {
  items: readonly SpecDefinition[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<SpecDataType>("NUMBER");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    const r = await callCatalog<{ definition: SpecDefinition }>(
      "POST",
      "/spec-definitions",
      readDefinition(e.currentTarget, newType),
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      setIssues(r.issues);
      return;
    }
    setCreating(false);
    setIssues([]);
    notify?.(`Specification “${r.data.definition.name}” created.`);
    router.refresh();
  }

  async function update(e: FormEvent<HTMLFormElement>, def: SpecDefinition) {
    e.preventDefault();
    const { key: _key, ...rest } = readDefinition(e.currentTarget, def.dataType);
    void _key;
    const body: SpecDefinitionUpdateRequest = {
      ...rest,
      dataType: def.dataType,
      archived: new FormData(e.currentTarget).get("archived") === "on",
      version: def.version,
    };
    setBusy(def.id);
    setError(null);
    const r = await callCatalog<{ definition: SpecDefinition }>(
      "POST",
      `/spec-definitions/${def.id}`,
      body,
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      setIssues(r.issues);
      return;
    }
    setEditing(null);
    setIssues([]);
    notify?.(`Specification “${def.name}” saved.`);
    router.refresh();
  }

  async function remove(def: SpecDefinition) {
    if (!window.confirm(`Delete the specification “${def.name}”? This cannot be undone.`)) return;
    setBusy(def.id);
    const r = await callCatalog("DELETE", `/spec-definitions/${def.id}`);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    notify?.(`Specification “${def.name}” deleted.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="px-5 sm:px-6">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState icon="list" title="No specifications defined yet">
          {canEdit
            ? "Define the technical properties you track for products, e.g. kinematic viscosity at 100 °C."
            : "The platform product team defines the specifications."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((def) => {
            const isEditing = editing === def.id;
            return (
              <li key={def.id} className={cx(isEditing && "bg-surface-2/60")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:px-6">
                  <Icon name="list" size={17} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{def.name}</span>
                      {def.required ? <StatusPill tone="amber">Required</StatusPill> : null}
                      {def.archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
                    </span>
                    <span className="block text-xs text-ink-3">
                      <span className="font-mono">{def.key}</span> · {TYPE_LABEL[def.dataType]}
                      {def.units.length ? ` · ${def.units.join(", ")}` : ""}
                      {def.testMethods.length ? ` · ${def.testMethods.join(", ")}` : ""} ·{" "}
                      {def.valueCount} product
                      {def.valueCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  {canEdit ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {busy === def.id ? <Spinner /> : null}
                      <button
                        type="button"
                        aria-expanded={isEditing}
                        onClick={() => {
                          setEditing(isEditing ? null : def.id);
                          setCreating(false);
                          setIssues([]);
                          setError(null);
                        }}
                        className={buttonStyles.ghost}
                      >
                        <Icon name="edit" size={16} />
                        <span className="hidden sm:inline">{isEditing ? "Close" : "Edit"}</span>
                        <span className="sr-only sm:hidden">Edit {def.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(def)}
                        disabled={busy !== null || def.valueCount > 0}
                        title={def.valueCount > 0 ? "In use: archive it instead" : "Delete"}
                        className={cx(buttonStyles.icon, "hover:text-danger")}
                      >
                        <Icon name="trash" size={16} />
                        <span className="sr-only">Delete {def.name}</span>
                      </button>
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <form
                    onSubmit={(e) => update(e, def)}
                    noValidate
                    className="space-y-3 px-5 pb-4 sm:px-6"
                  >
                    <DefinitionFields
                      prefix={`edit-${def.id}`}
                      def={def}
                      dataType={def.dataType}
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
                        Save specification
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
              <h3 className="text-sm font-semibold text-ink">New specification</h3>
              <DefinitionFields
                prefix="new"
                def={null}
                dataType={newType}
                onType={setNewType}
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
                  Create specification
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setIssues([]);
                setError(null);
              }}
              className={buttonStyles.secondary}
            >
              <Icon name="plus" size={17} />
              New specification
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
