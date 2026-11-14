"use client";

import {
  checkSpecValue,
  specTarget,
  type ProductSpecsResponse,
  type ProductValidation,
  type SpecDefinition,
  type SpecValueBasis,
  type SpecValuesSaveRequest,
  type ValidationIssue,
} from "@dream/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { callCatalog } from "../../lib/catalog-client";
import {
  draftForCheck,
  draftsDiffer,
  draftValue,
  liveValidation,
  slotKey,
  SPEC_BASES,
  type Draft,
} from "../../lib/spec-validation";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill } from "../ui";
import { FIELD, FormMessage } from "./parts";
import { useNotice } from "./notices";

function initialDraft(
  def: SpecDefinition,
  data: ProductSpecsResponse,
  basis: SpecValueBasis,
): Draft {
  const v = data.values.find((x) => x.definitionId === def.id && x.basis === basis);
  const val = v?.value;
  return {
    on: Boolean(v),
    basis,
    number: val?.type === "NUMBER" ? String(val.number) : "",
    min: val?.type === "RANGE" && val.min !== null ? String(val.min) : "",
    max: val?.type === "RANGE" && val.max !== null ? String(val.max) : "",
    minExclusive: val?.type === "RANGE" ? val.minExclusive : false,
    maxExclusive: val?.type === "RANGE" ? val.maxExclusive : false,
    text: val?.type === "TEXT" ? val.text : "",
    bool: val?.type === "BOOLEAN" ? (val.boolean ? "true" : "false") : "",
    unit: v?.unit ?? def.units[0] ?? "",
    testMethod: v?.testMethod ?? "",
  };
}

export { draftValue };

const TYPE_LABEL: Record<SpecDefinition["dataType"], string> = {
  NUMBER: "Number",
  RANGE: "Range",
  TEXT: "Text",
  BOOLEAN: "Yes / no",
};

interface Issues {
  blocking: string[];
  warnings: string[];
}

export function SpecEditor({
  productId,
  data,
  canEdit,
  archived,
}: {
  productId: string;
  data: ProductSpecsResponse;
  canEdit: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [saved] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      data.definitions.flatMap((d) =>
        SPEC_BASES.map((b) => [slotKey(d.id, b), initialDraft(d, data, b)]),
      ),
    ),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(saved);
  const [serverIssues, setServerIssues] = useState<{ path: string; rule: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !canEdit || archived;

  const set = (slot: string, patch: Partial<Draft>) => {
    setServerIssues([]);
    setDrafts((all) => ({ ...all, [slot]: { ...(all[slot] as Draft), ...patch } }));
  };

  /** Live, per-value problems from the shared validation engine (one entry per slot). */
  const fieldIssues = useMemo(() => {
    const out = new Map<string, Issues>();
    for (const def of data.definitions) {
      for (const basis of SPEC_BASES) {
        const slot = slotKey(def.id, basis);
        const d = drafts[slot] as Draft;
        const entry: Issues = { blocking: [], warnings: [] };
        if (!d.on) {
          if (def.required && basis === "SPECIFICATION")
            entry.blocking.push("Required for publication.");
        } else {
          // The same value the save request sends (unit and test method normalised alike).
          const v = draftForCheck(def, d);
          if (v === "empty") entry.blocking.push("Enter a value or remove it.");
          else if (v === "not_a_number") entry.blocking.push("Enter a number.");
          else {
            const issues: ValidationIssue[] = checkSpecValue(def, v);
            for (const i of issues)
              (i.severity === "BLOCKING" ? entry.blocking : entry.warnings).push(
                i.message.replace(`${def.name}: `, ""),
              );
          }
        }
        for (const s of serverIssues.filter((x) => x.path === specTarget(def.key, basis))) {
          entry.blocking.push(`Refused by the server (${s.rule.replace(/_/g, " ")}).`);
        }
        out.set(slot, entry);
      }
    }
    return out;
  }, [data.definitions, drafts, serverIssues]);

  /** The summary: the shared engine over the values as typed (PM-3 validation review). */
  const live: ProductValidation = useMemo(
    () => liveValidation(data.definitions, drafts, data.validation),
    [data.definitions, data.validation, drafts],
  );
  const dirty = useMemo(() => draftsDiffer(saved, drafts), [saved, drafts]);

  // Missing required values do not block saving a draft; a bad entered value does.
  const blockingFieldCount = data.definitions
    .flatMap((def) => SPEC_BASES.map((b) => slotKey(def.id, b)))
    .filter((slot) => drafts[slot]?.on && (fieldIssues.get(slot)?.blocking.length ?? 0) > 0).length;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const values: SpecValuesSaveRequest["values"] = [];
    for (const def of data.definitions) {
      for (const basis of SPEC_BASES) {
        const d = drafts[slotKey(def.id, basis)] as Draft;
        if (!d.on) continue;
        const v = draftForCheck(def, d);
        if (v === "empty" || v === "not_a_number") {
          const what = basis === "TYPICAL" ? `${def.name} (typical)` : def.name;
          setError(`${what}: ${v === "empty" ? "enter a value or remove it" : "enter a number"}.`);
          return;
        }
        values.push(v);
      }
    }
    setPending(true);
    setError(null);
    setServerIssues([]);
    const result = await callCatalog<ProductSpecsResponse>("POST", `/products/${productId}/specs`, {
      version: data.productVersion,
      values,
    } satisfies SpecValuesSaveRequest);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setServerIssues(result.issues);
      notify?.(result.message, "error");
      return;
    }
    notify?.("Technical specifications saved.");
    router.refresh();
  }

  if (data.definitions.length === 0) {
    return (
      <EmptyState
        icon="list"
        title="No specifications defined yet"
        {...(canEdit
          ? { action: { href: "/products/specifications", label: "Define specifications" } }
          : {})}
      >
        Specifications (viscosity, flash point, …) are defined once for the whole platform, then
        filled in per product.
      </EmptyState>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <ValidationSummary validation={live} unsaved={dirty} />
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.definitions.map((def) => {
          const specSlot = slotKey(def.id, "SPECIFICATION");
          const typicalSlot = slotKey(def.id, "TYPICAL");
          const typical = drafts[typicalSlot] as Draft;
          return (
            <li
              key={def.id}
              className="grid grid-cols-1 gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {def.name}
                  {def.required ? <StatusPill tone="amber">Required</StatusPill> : null}
                  {def.archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  <span className="font-mono">{def.key}</span> · {TYPE_LABEL[def.dataType]}
                  {def.minValue !== null || def.maxValue !== null
                    ? ` · ${def.minValue ?? "…"} – ${def.maxValue ?? "…"}`
                    : ""}
                </p>
              </div>
              <div className="min-w-0 space-y-3">
                <ValueEditor
                  def={def}
                  draft={drafts[specSlot] as Draft}
                  issues={fieldIssues.get(specSlot) ?? { blocking: [], warnings: [] }}
                  readOnly={readOnly}
                  onChange={(patch) => set(specSlot, patch)}
                />
                {typical.on ? (
                  <ValueEditor
                    def={def}
                    draft={typical}
                    issues={fieldIssues.get(typicalSlot) ?? { blocking: [], warnings: [] }}
                    readOnly={readOnly}
                    onChange={(patch) => set(typicalSlot, patch)}
                  />
                ) : !readOnly && def.dataType !== "BOOLEAN" ? (
                  <button
                    type="button"
                    onClick={() => set(typicalSlot, { on: true })}
                    className={cx(buttonStyles.ghost, "text-xs")}
                  >
                    <Icon name="plus" size={14} />
                    Add typical value
                    <span className="sr-only"> for {def.name}</span>
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {readOnly ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Icon name="shield" size={16} />
          {archived
            ? "This product is archived. Restore it to edit its specifications."
            : "Specifications are part of the product master (product_master:edit)."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/products/specifications"
            className="text-sm font-medium text-petrol-strong hover:underline"
          >
            Manage specification definitions
          </Link>
          <button
            type="submit"
            disabled={pending || blockingFieldCount > 0}
            className={buttonStyles.primary}
          >
            {pending ? <Spinner /> : <Icon name="check" size={17} />}
            {pending ? "Saving…" : "Save specifications"}
          </button>
        </div>
      )}
    </form>
  );
}

/**
 * The inputs of one value (the specification value, or the typical value: DP-156). A range takes
 * a minimum, a maximum or both, each closed (≥ / ≤) or open (> / <).
 */
function ValueEditor({
  def,
  draft: d,
  issues,
  readOnly,
  onChange,
}: {
  def: SpecDefinition;
  draft: Draft;
  issues: Issues;
  readOnly: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const typical = d.basis === "TYPICAL";
  const label = typical ? `${def.name} typical value` : def.name;
  const base = `spec-${def.id}${typical ? "-typical" : ""}`;
  const describedBy =
    issues.blocking.length || issues.warnings.length ? `${base}-issues` : undefined;
  const invalid = d.on && issues.blocking.length > 0 ? true : undefined;
  return (
    <div className="space-y-2">
      {typical ? (
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
          Typical value <span className="normal-case">(for information, not a limit)</span>
        </p>
      ) : null}
      {!d.on ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-3">No value</span>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => onChange({ on: true })}
              className={buttonStyles.ghost}
            >
              <Icon name="plus" size={16} />
              Add value
              <span className="sr-only"> for {def.name}</span>
            </button>
          ) : null}
        </div>
      ) : (
        <fieldset disabled={readOnly} className="flex flex-wrap items-end gap-2">
          <legend className="sr-only">{label}</legend>
          {def.dataType === "NUMBER" ? (
            <label className="w-full sm:w-40">
              <span className="sr-only">{label}</span>
              <input
                inputMode="decimal"
                value={d.number}
                onChange={(e) => onChange({ number: e.currentTarget.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                placeholder="Value"
                className={cx(FIELD, "tabular")}
              />
            </label>
          ) : null}
          {def.dataType === "RANGE" ? (
            <>
              <div className="flex w-full gap-1 sm:w-auto">
                <label className="w-16 shrink-0">
                  <span className="sr-only">{label} minimum: closed or open</span>
                  <select
                    value={d.minExclusive ? "open" : "closed"}
                    onChange={(e) => onChange({ minExclusive: e.currentTarget.value === "open" })}
                    className={FIELD}
                  >
                    <option value="closed">≥</option>
                    <option value="open">&gt;</option>
                  </select>
                </label>
                <label className="min-w-0 flex-1 sm:w-28 sm:flex-none">
                  <span className="sr-only">{label} minimum</span>
                  <input
                    inputMode="decimal"
                    value={d.min}
                    onChange={(e) => onChange({ min: e.currentTarget.value })}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    placeholder="Min"
                    className={cx(FIELD, "tabular")}
                  />
                </label>
              </div>
              <div className="flex w-full gap-1 sm:w-auto">
                <label className="w-16 shrink-0">
                  <span className="sr-only">{label} maximum: closed or open</span>
                  <select
                    value={d.maxExclusive ? "open" : "closed"}
                    onChange={(e) => onChange({ maxExclusive: e.currentTarget.value === "open" })}
                    className={FIELD}
                  >
                    <option value="closed">≤</option>
                    <option value="open">&lt;</option>
                  </select>
                </label>
                <label className="min-w-0 flex-1 sm:w-28 sm:flex-none">
                  <span className="sr-only">{label} maximum</span>
                  <input
                    inputMode="decimal"
                    value={d.max}
                    onChange={(e) => onChange({ max: e.currentTarget.value })}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    placeholder="Max"
                    className={cx(FIELD, "tabular")}
                  />
                </label>
              </div>
            </>
          ) : null}
          {def.dataType === "TEXT" ? (
            <label className="w-full">
              <span className="sr-only">{label}</span>
              <input
                value={d.text}
                maxLength={def.maxLength ?? 2000}
                onChange={(e) => onChange({ text: e.currentTarget.value })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={FIELD}
              />
            </label>
          ) : null}
          {def.dataType === "BOOLEAN" ? (
            <label className="w-full sm:w-40">
              <span className="sr-only">{label}</span>
              <select
                value={d.bool}
                onChange={(e) => onChange({ bool: e.currentTarget.value as Draft["bool"] })}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={FIELD}
              >
                <option value="">Choose…</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          ) : null}
          {def.units.length > 0 ? (
            <label className="w-full sm:w-32">
              <span className="sr-only">{label} unit</span>
              <select
                value={d.unit}
                onChange={(e) => onChange({ unit: e.currentTarget.value })}
                className={FIELD}
              >
                {def.units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="w-full sm:w-44">
            <span className="sr-only">{label} test method</span>
            <input
              list={`${base}-methods`}
              value={d.testMethod}
              maxLength={64}
              onChange={(e) => onChange({ testMethod: e.currentTarget.value })}
              placeholder={def.testMethods[0] ?? "Test method"}
              className={FIELD}
            />
            <datalist id={`${base}-methods`}>
              {def.testMethods.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => onChange({ on: false })}
              className={cx(buttonStyles.icon, "hover:text-danger")}
            >
              <Icon name="trash" size={16} />
              <span className="sr-only">
                Remove the {typical ? "typical value" : "value"} of {def.name}
              </span>
            </button>
          ) : null}
        </fieldset>
      )}
      {describedBy ? (
        <ul id={`${base}-issues`} className="space-y-0.5 text-xs">
          {issues.blocking.map((m) => (
            <li
              key={m}
              className={cx("flex items-center gap-1.5", d.on ? "text-danger" : "text-amber-ink")}
            >
              <Icon name="alert" size={13} />
              {m}
            </li>
          ))}
          {issues.warnings.map((m) => (
            <li key={m} className="flex items-center gap-1.5 text-amber-ink">
              <Icon name="alert" size={13} />
              {m}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The publishing check of the product's technical data (shared engine, BLOCKING / WARNING). */
export function ValidationSummary({
  validation,
  unsaved = false,
}: {
  validation: ProductSpecsResponse["validation"];
  /** The report covers values typed but not saved yet. */
  unsaved?: boolean;
}) {
  const { blocking, warnings } = validation;
  const note = unsaved ? (
    <p className="flex items-center gap-1.5 text-xs text-ink-3" role="status">
      <Icon name="alert" size={13} />
      Checked as typed: includes changes that are not saved yet.
    </p>
  ) : null;
  if (!blocking.length && !warnings.length) {
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success ring-1 ring-inset ring-success/25">
          <Icon name="check" size={16} />
          Technical data complete: nothing blocks publication.
        </p>
        {note}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {note}
      {blocking.length ? (
        <details
          open
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25"
        >
          <summary className="cursor-pointer font-medium">
            {blocking.length} blocking issue{blocking.length === 1 ? "" : "s"} — publication would
            be refused
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {blocking.map((i) => (
              <li key={`${i.target}-${i.code}`}>{i.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {warnings.length ? (
        <details className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30">
          <summary className="cursor-pointer font-medium">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {warnings.map((i) => (
              <li key={`${i.target}-${i.code}`}>{i.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
