"use client";

/**
 * Cross-references of a product master (PM-6, DP-036; ADR-015). SIMILAR is staff judgement;
 * VERIFIED needs a technical comparison, the active revision of one of this product's technical
 * documents as evidence and a second person with product:approve. The API decides every action;
 * this component only hides buttons the caller cannot use and explains why.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  CATALOG_API,
  CROSS_REFERENCE_STATUS_LABELS,
  GlobalProductListResponseSchema,
  VERIFICATION_STALE_TEXT,
  XREF_COMMENT_MAX,
  XREF_PUBLICATION_ACK_TEXT,
  XREF_PUBLICATION_ACK_VERSION,
  XREF_COMPARISON_MAX,
  XREF_DESCRIPTION_MAX,
  type CrossReferenceSite,
  type CrossReferenceStatus,
  type GlobalProduct,
  type ProductCrossReference,
} from "@dream/contracts";
import { callCatalog } from "../../lib/catalog-client";
import { Icon } from "../icons";
import { buttonStyles, cx, StatusPill, type PillTone } from "../ui";
import { revisionHref } from "./document-manager";
import { useNotice } from "./notices";
import { Field, FIELD, FormMessage, SITE_SHORT, TEXTAREA } from "./parts";

/** A technical document revision that can serve as evidence (active revision, active document). */
export interface SourceOption {
  revisionId: string;
  label: string;
}

const STATUS_TONE: Readonly<Record<CrossReferenceStatus, PillTone>> = {
  SIMILAR: "neutral",
  PENDING_VERIFICATION: "amber",
  VERIFIED: "success",
  REMOVED: "neutral",
};

const SITE_TEXT: Readonly<Record<CrossReferenceSite["state"], { label: string; tone: PillTone }>> =
  {
    shown: { label: "Shown", tone: "success" },
    hidden: { label: "Not shown", tone: "neutral" },
    not_publishable: { label: "Cannot be shown", tone: "neutral" },
    verification_stale: { label: "Hidden: verification stale", tone: "danger" },
    product_not_live: { label: "Product not live", tone: "amber" },
  };

const ACTION_TEXT: Readonly<Record<ProductCrossReference["events"][number]["action"], string>> = {
  CREATED: "Created",
  UPDATED: "Changed",
  VERIFICATION_REQUESTED: "Verification requested",
  VERIFIED: "Verified",
  VERIFICATION_REJECTED: "Verification rejected",
  MARKED_SIMILAR: "Marked similar",
  VERIFICATION_RESET: "Changed (verification reset)",
  REMOVED: "Removed",
  RESTORED: "Restored",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const when = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "");

const productLabel = (p: Pick<GlobalProduct, "name" | "grade">) =>
  p.grade ? `${p.name} · ${p.grade}` : p.name;

type XrefResult = { crossReference: ProductCrossReference };

export function CrossReferenceManager({
  productId,
  items: initial,
  canEdit,
  canApprove,
  productArchived,
  sources,
}: {
  productId: string;
  items: ProductCrossReference[];
  canEdit: boolean;
  canApprove: boolean;
  productArchived: boolean;
  sources: SourceOption[];
}) {
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState(false);
  const notify = useNotice();

  const replace = (x: ProductCrossReference, message: string) => {
    setItems((list) => {
      const found = list.some((i) => i.id === x.id);
      return found ? list.map((i) => (i.id === x.id ? x : i)) : [...list, x];
    });
    notify?.(message, "success");
  };

  const live = items.filter((i) => i.status !== "REMOVED");
  const removed = items.filter((i) => i.status === "REMOVED");
  const editable = canEdit && !productArchived;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl">
          <strong className="text-ink">Similar</strong> is a staff judgement.{" "}
          <strong className="text-ink">Verified</strong> needs a technical comparison, a source
          document of this product and a second person who may approve. A site shows a
          cross-reference only when its publisher enables it; a stale verification is never shown.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/products/brands" className={buttonStyles.secondary}>
            <Icon name="list" size={17} />
            Global brands
          </Link>
          {editable && !adding ? (
            <button type="button" className={buttonStyles.primary} onClick={() => setAdding(true)}>
              <Icon name="plus" size={17} />
              Add cross-reference
            </button>
          ) : null}
        </div>
      </div>

      {adding ? (
        <AddForm
          productId={productId}
          existing={items.map((i) => i.globalProduct.id)}
          onCancel={() => setAdding(false)}
          onCreated={(x) => {
            setAdding(false);
            replace(
              x,
              `Cross-reference to ${x.globalProduct.brand.name} ${x.globalProduct.name} added as similar.`,
            );
          }}
        />
      ) : null}

      {live.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3">
          No cross-references yet.
          {editable ? " Add one to relate this product to another brand's product." : null}
        </p>
      ) : (
        <ul className="space-y-3">
          {live.map((x) => (
            <XrefCard
              key={x.id}
              x={x}
              canEdit={editable}
              canApprove={canApprove}
              sources={sources}
              onChange={replace}
            />
          ))}
        </ul>
      )}

      {removed.length ? (
        <details className="rounded-xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            Removed ({removed.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {removed.map((x) => (
              <XrefCard
                key={x.id}
                x={x}
                canEdit={editable}
                canApprove={canApprove}
                sources={sources}
                onChange={replace}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// --- add ------------------------------------------------------------------------------------

function AddForm({
  productId,
  existing,
  onCancel,
  onCreated,
}: {
  productId: string;
  existing: string[];
  onCancel: () => void;
  onCreated: (x: ProductCrossReference) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GlobalProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<GlobalProduct | null>(null);
  const [description, setDescription] = useState("");
  const [comparison, setComparison] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${CATALOG_API}/global-products?q=${encodeURIComponent(term)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const parsed = GlobalProductListResponseSchema.safeParse(await res.json());
        setResults(parsed.success ? parsed.data.items : []);
      } catch {
        // aborted or offline: keep the last results
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) {
      setError("Choose the global product first.");
      return;
    }
    setBusy(true);
    const r = await callCatalog<XrefResult>("POST", `/products/${productId}/cross-references`, {
      globalProductId: picked.id,
      description: description || null,
      comparison: comparison || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onCreated(r.data.crossReference);
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-raised"
      aria-labelledby={`${id}-h`}
    >
      <h3 id={`${id}-h`} className="text-base font-semibold text-ink">
        Add cross-reference
      </h3>
      <Field
        label="Global product"
        htmlFor={`${id}-q`}
        hint="Search by brand, manufacturer, product or grade. Missing? Add it under Global brands."
      >
        <div className="relative">
          <input
            id={`${id}-q`}
            className={cx(FIELD, "pl-9")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
            }}
            placeholder="e.g. Example Base 6"
            autoComplete="off"
          />
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
        </div>
      </Field>
      {q.trim().length >= 2 ? (
        <fieldset className="space-y-1" aria-busy={searching}>
          <legend className="sr-only">Search results</legend>
          {results.length === 0 ? (
            <p className="text-sm text-ink-3">{searching ? "Searching…" : "No match."}</p>
          ) : (
            results.map((p) => {
              const taken = existing.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm ring-1 ring-inset",
                    picked?.id === p.id
                      ? "bg-petrol/8 ring-petrol"
                      : "ring-line hover:bg-surface-2",
                    taken && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-pick`}
                    className="mt-1"
                    disabled={taken}
                    checked={picked?.id === p.id}
                    onChange={() => setPicked(p)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">
                      {p.brand.name} — {productLabel(p)}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {p.brand.manufacturer}
                      {taken ? " · already cross-referenced" : ""}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </fieldset>
      ) : null}
      <Field label="Explanation (internal)" htmlFor={`${id}-d`}>
        <textarea
          id={`${id}-d`}
          className={TEXTAREA}
          maxLength={XREF_DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label="Technical comparison (internal)"
        htmlFor={`${id}-c`}
        hint="Required before verification: properties, values and test methods you compared."
      >
        <textarea
          id={`${id}-c`}
          className={TEXTAREA}
          maxLength={XREF_COMPARISON_MAX}
          value={comparison}
          onChange={(e) => setComparison(e.target.value)}
        />
      </Field>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={buttonStyles.primary} disabled={busy}>
          Add as similar
        </button>
      </div>
    </form>
  );
}

// --- one cross-reference --------------------------------------------------------------------

type Mode =
  | { kind: "view" }
  | { kind: "edit" }
  | { kind: "request" }
  | { kind: "reason"; action: "reject" | "mark-similar" | "remove" };

const REASON_TEXT = {
  reject: { title: "Reject the verification", button: "Reject", done: "Verification rejected." },
  "mark-similar": {
    title: "Mark as similar again",
    button: "Mark similar",
    done: "Marked as similar.",
  },
  remove: {
    title: "Remove the cross-reference",
    button: "Remove",
    done: "Cross-reference removed.",
  },
} as const;

function XrefCard({
  x,
  canEdit,
  canApprove,
  sources,
  onChange,
}: {
  x: ProductCrossReference;
  canEdit: boolean;
  canApprove: boolean;
  sources: SourceOption[];
  onChange: (x: ProductCrossReference, message: string) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(x.description ?? "");
  const [comparison, setComparison] = useState(x.comparison ?? "");
  const [source, setSource] = useState(sources[0]?.revisionId ?? "");
  const [comment, setComment] = useState("");
  const v = x.verification;
  const removed = x.status === "REMOVED";

  async function run(path: string, body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    const r = await callCatalog<XrefResult>("POST", path, { ...body, version: x.version });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      if (r.issues.some((i) => i.rule === "stale")) router.refresh();
      return false;
    }
    onChange(r.data.crossReference, message);
    setMode({ kind: "view" });
    setComment("");
    return true;
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(
      `/cross-references/${x.id}`,
      { description: description || null, comparison: comparison || null },
      x.status === "SIMILAR" ? "Cross-reference saved." : "Saved; the relation is similar again.",
    );
  };

  return (
    <li
      aria-labelledby={`${id}-t`}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-raised"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-t`} className="text-base font-semibold text-ink">
              {x.globalProduct.brand.name} — {productLabel(x.globalProduct)}
            </h3>
            <StatusPill tone={STATUS_TONE[x.status]}>
              {CROSS_REFERENCE_STATUS_LABELS[x.status]}
            </StatusPill>
            {v.state === "stale" ? <StatusPill tone="danger">Verification stale</StatusPill> : null}
            {x.globalProduct.status === "ARCHIVED" ||
            x.globalProduct.brand.status === "ARCHIVED" ? (
              <StatusPill tone="neutral">Global product archived</StatusPill>
            ) : null}
          </div>
          <p className="text-xs text-ink-3">{x.globalProduct.brand.manufacturer}</p>
          {x.description ? <p className="text-sm text-ink-2">{x.description}</p> : null}
        </div>
      </div>

      {x.comparison ? (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            Technical comparison
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{x.comparison}</p>
        </details>
      ) : null}

      {v.state !== "none" ? (
        <div className="space-y-2 border-t border-line bg-surface-2/60 px-4 py-3 text-sm">
          {v.source ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
              <Icon name="document" size={16} className="text-ink-3" />
              Source: {v.source.documentType} · {v.source.documentTitle} · revision{" "}
              {v.source.revisionNumber}
              {v.source.isActiveRevision ? null : (
                <span className="text-danger">(no longer the active revision)</span>
              )}
              <a
                href={revisionHref(v.source.revisionId, "inline")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-petrol-strong underline-offset-2 hover:underline"
              >
                Preview<span className="sr-only"> the source document (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
          {v.requestedBy ? (
            <p className="text-ink-3">
              Requested by {v.requestedBy.name} · {when(v.requestedAt)}
            </p>
          ) : null}
          {v.verifiedBy ? (
            <p className="text-ink-3">
              Verified by {v.verifiedBy.name} · {when(v.verifiedAt)}
            </p>
          ) : null}
          {v.staleReasons.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-danger">
              {v.staleReasons.map((r) => (
                <li key={r}>{VERIFICATION_STALE_TEXT[r]}</li>
              ))}
            </ul>
          ) : null}
          {x.status === "PENDING_VERIFICATION" && !x.canVerify ? (
            <p className="text-xs text-ink-3">
              {x.verifyBlockedReason === "own_change"
                ? "You requested or changed this relation, so another approver must decide."
                : "Waiting for a person who may approve product data."}
            </p>
          ) : null}
        </div>
      ) : null}

      {!removed ? (
        <ul className="divide-y divide-line border-t border-line px-4" aria-label="Sites">
          {x.sites.map((s) => (
            <SiteRow key={s.siteId} x={x} site={s} busy={busy} run={run} />
          ))}
        </ul>
      ) : null}

      {mode.kind === "edit" ? (
        <form onSubmit={save} className="space-y-3 border-t border-line p-4">
          {x.status !== "SIMILAR" ? (
            <FormMessage kind="error">
              Saving a change makes this relation similar again; it needs a new verification.
            </FormMessage>
          ) : null}
          <Field label="Explanation (internal)" htmlFor={`${id}-d`}>
            <textarea
              id={`${id}-d`}
              className={TEXTAREA}
              maxLength={XREF_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Technical comparison (internal)" htmlFor={`${id}-c`}>
            <textarea
              id={`${id}-c`}
              className={TEXTAREA}
              maxLength={XREF_COMPARISON_MAX}
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            />
          </Field>
          <FormButtons busy={busy} label="Save" onCancel={() => setMode({ kind: "view" })} />
        </form>
      ) : null}

      {mode.kind === "request" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              `/cross-references/${x.id}/request-verification`,
              { sourceRevisionId: source, comment: comment || null },
              "Verification requested.",
            );
          }}
          className="space-y-3 border-t border-line p-4"
        >
          {sources.length === 0 ? (
            <FormMessage kind="error">
              Upload a technical document for this product first (Documents section): the
              verification needs its active revision as evidence.
            </FormMessage>
          ) : (
            <Field
              label="Source document"
              htmlFor={`${id}-s`}
              hint="The active revision is recorded; a newer revision later makes the verification stale."
            >
              <select
                id={`${id}-s`}
                className={FIELD}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.revisionId} value={s.revisionId}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Note for the approver (optional)" htmlFor={`${id}-n`}>
            <textarea
              id={`${id}-n`}
              className={cx(TEXTAREA, "min-h-20")}
              maxLength={XREF_COMMENT_MAX}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <FormButtons
            busy={busy || sources.length === 0 || !x.comparison}
            label="Request verification"
            onCancel={() => setMode({ kind: "view" })}
          />
          {!x.comparison ? (
            <p className="text-xs text-ink-3">Add the technical comparison first (Edit).</p>
          ) : null}
        </form>
      ) : null}

      {mode.kind === "reason" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              `/cross-references/${x.id}/${mode.action}`,
              { comment },
              REASON_TEXT[mode.action].done,
            );
          }}
          className="space-y-3 border-t border-line p-4"
        >
          <Field label={`${REASON_TEXT[mode.action].title}: reason`} htmlFor={`${id}-r`}>
            <textarea
              id={`${id}-r`}
              className={cx(TEXTAREA, "min-h-20")}
              required
              maxLength={XREF_COMMENT_MAX}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <FormButtons
            busy={busy}
            label={REASON_TEXT[mode.action].button}
            danger={mode.action !== "mark-similar"}
            onCancel={() => setMode({ kind: "view" })}
          />
        </form>
      ) : null}

      {error ? (
        <div className="px-4 pb-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
        <History x={x} />
        {mode.kind === "view" ? (
          <div className="flex flex-wrap gap-1">
            {x.canVerify ? (
              <>
                <button
                  type="button"
                  className={buttonStyles.primary}
                  disabled={busy}
                  onClick={() =>
                    void run(`/cross-references/${x.id}/verify`, {}, "Cross-reference verified.")
                  }
                >
                  <Icon name="check" size={16} />
                  Verify
                </button>
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  onClick={() => setMode({ kind: "reason", action: "reject" })}
                >
                  Reject
                </button>
              </>
            ) : null}
            {canEdit && !removed && (x.status === "SIMILAR" || v.state === "stale") ? (
              <button
                type="button"
                className={buttonStyles.ghost}
                onClick={() => setMode({ kind: "request" })}
              >
                <Icon name="shield" size={16} />
                {x.status === "VERIFIED" ? "Verify again" : "Request verification"}
              </button>
            ) : null}
            {(canEdit || canApprove) &&
            (x.status === "PENDING_VERIFICATION" || x.status === "VERIFIED") ? (
              <button
                type="button"
                className={buttonStyles.ghost}
                onClick={() => setMode({ kind: "reason", action: "mark-similar" })}
              >
                Mark similar
              </button>
            ) : null}
            {canEdit && !removed ? (
              <>
                <button
                  type="button"
                  className={buttonStyles.ghost}
                  onClick={() => setMode({ kind: "edit" })}
                >
                  <Icon name="edit" size={16} />
                  Edit
                </button>
                <button
                  type="button"
                  className={buttonStyles.ghost}
                  onClick={() => setMode({ kind: "reason", action: "remove" })}
                >
                  <Icon name="trash" size={16} />
                  Remove
                </button>
              </>
            ) : null}
            {canEdit && removed ? (
              <button
                type="button"
                className={buttonStyles.ghost}
                disabled={busy}
                onClick={() =>
                  void run(`/cross-references/${x.id}/restore`, {}, "Restored as similar.")
                }
              >
                <Icon name="refresh" size={16} />
                Restore
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function FormButtons({
  busy,
  label,
  danger,
  onCancel,
}: {
  busy: boolean;
  label: string;
  danger?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className={cx(buttonStyles.primary, danger && "bg-danger hover:bg-danger/90")}
      >
        {label}
      </button>
    </div>
  );
}

function SiteRow({
  x,
  site,
  busy,
  run,
}: {
  x: ProductCrossReference;
  site: CrossReferenceSite;
  busy: boolean;
  run: (path: string, body: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const text = SITE_TEXT[site.state];
  const blocked = site.state === "not_publishable" || site.state === "verification_stale";
  const path = `/cross-references/${x.id}/sites/${site.siteId}`;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="w-36 shrink-0 text-sm font-medium text-ink sm:w-44">
            {SITE_SHORT[site.siteKey]}
          </span>
          <StatusPill tone={text.tone}>{text.label}</StatusPill>
          {site.shownAs ? (
            <span className="text-xs text-ink-3">
              as {site.shownAs === "VERIFIED" ? "verified" : "similar"}
            </span>
          ) : null}
        </span>
        {site.canPublish ? (
          site.enabled ? (
            <button
              type="button"
              disabled={busy}
              className={cx(buttonStyles.secondary, "h-9 px-3 text-sm")}
              onClick={() =>
                void run(path, { visible: false }, `Hidden on ${SITE_SHORT[site.siteKey]}.`)
              }
            >
              Hide on {SITE_SHORT[site.siteKey]}
            </button>
          ) : confirming ? null : (
            <button
              type="button"
              disabled={busy || blocked}
              aria-expanded={confirming}
              className={cx(buttonStyles.secondary, "h-9 px-3 text-sm")}
              onClick={() => {
                setAccepted(false);
                setConfirming(true);
              }}
            >
              Show on {SITE_SHORT[site.siteKey]}…
            </button>
          )
        ) : (
          <span className="text-xs text-ink-3">
            {site.enabled ? "Enabled by the site publisher" : "Not enabled"}
          </span>
        )}
      </div>
      {confirming && !site.enabled ? (
        <form
          className="mt-3 space-y-3 rounded-lg border border-amber/40 bg-amber-soft/40 p-3"
          aria-labelledby={`${id}-ack`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!accepted) return;
            const ok = await run(
              path,
              {
                visible: true,
                acknowledgement: { version: XREF_PUBLICATION_ACK_VERSION, accepted: true },
              },
              `Shown on ${SITE_SHORT[site.siteKey]}; your confirmation is recorded.`,
            );
            if (ok) setConfirming(false);
          }}
        >
          <p id={`${id}-ack`} className="text-sm font-medium text-ink">
            Publishing responsibility
          </p>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>{XREF_PUBLICATION_ACK_TEXT}</span>
          </label>
          <p className="text-xs text-ink-3">
            Your name, the time and the statement version ({XREF_PUBLICATION_ACK_VERSION}) are
            recorded in the audit trail.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button type="submit" className={buttonStyles.primary} disabled={busy || !accepted}>
              Confirm and show on {SITE_SHORT[site.siteKey]}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function History({ x }: { x: ProductCrossReference }) {
  return (
    <details className="text-sm">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink-2">
        <Icon name="history" size={16} />
        History ({x.events.length})
      </summary>
      <ol className="mt-2 space-y-2">
        {x.events.map((e) => (
          <li key={e.id} className="text-ink-2">
            <span className="font-medium text-ink">{ACTION_TEXT[e.action]}</span> · {e.actor.name} ·{" "}
            <span className="text-ink-3">{when(e.createdAt)}</span>
            {e.comment ? <span className="block text-ink-3">“{e.comment}”</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
