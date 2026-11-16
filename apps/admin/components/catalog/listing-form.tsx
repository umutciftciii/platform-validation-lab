"use client";

import { DESCRIPTION_MAX, type Category, type Listing, type SiteProposal } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { flattenTree } from "../../lib/catalog-view";
import { listingSaveBody } from "../../lib/listing-request";
import { formHasChanges } from "../../lib/product-tabs";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { Field, FIELD, FormMessage, TEXTAREA } from "./parts";
import { useNotice } from "./notices";
import { useUnsavedChanges } from "./product-tabs";

/**
 * The product's listing on one site (product:edit of that site): the site's category, sort order
 * and the site's own English texts. Creating a listing without a category uses the site default.
 *
 * DP-197: the form has no visibility control. A save sends the listing's saved visibility back
 * unchanged (a new listing starts off the site), so saving never shows, publishes or unpublishes
 * anything; the Publication tab's Publish switches the listing on when needed.
 *
 * DP-193: "Copy research proposal" fills the summary and description fields with the site's
 * research proposal (DP-171) — the fields only: nothing is written until Save, the copied text
 * stays editable and "Discard changes" restores the saved values. Technical values held for
 * verification (DP-002) are never copied. The form says when the saved text differs from the
 * proposal and lists the proposal's claim-risk notes.
 */
export function ListingForm({
  productId,
  siteId,
  siteName,
  listing,
  categories,
  canEdit,
  proposal = null,
}: {
  productId: string;
  siteId: string;
  siteName: string;
  listing: Listing | null;
  categories: readonly Category[];
  canEdit: boolean;
  /** DP-193: the site's research proposal, if any. */
  proposal?: SiteProposal | null;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const tree = flattenTree(categories);
  const defaultCategory = categories.find((c) => c.isDefault);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;
  const id = (name: string) => `listing-${siteId}-${name}`;
  // DP-187: unsaved edits mark the Content tab and are confirmed before a site switch.
  const [fieldsChanged, setFieldsChanged] = useState(false);
  useUnsavedChanges(canEdit && fieldsChanged);
  const track = (e: FormEvent<HTMLFormElement>) =>
    setFieldsChanged(formHasChanges(e.currentTarget));

  // DP-193: copy the research proposal into the fields (never saved by itself).
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const proposalHasText = !!(proposal && (proposal.summary || proposal.description));
  const savedSummary = listing?.text?.summary ?? null;
  const savedDescription = listing?.text?.description ?? null;
  const differs =
    proposalHasText &&
    (proposal!.summary !== savedSummary || proposal!.description !== savedDescription);
  function copyProposal() {
    if (!proposal || !summaryRef.current || !descriptionRef.current || !formRef.current) return;
    summaryRef.current.value = proposal.summary ?? "";
    descriptionRef.current.value = proposal.description ?? "";
    setFieldsChanged(formHasChanges(formRef.current));
    setCopied(true);
    setSaved(false);
  }
  function discard() {
    formRef.current?.reset();
    setFieldsChanged(false);
    setCopied(false);
    setError(null);
    setIssues([]);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const categoryId = String(form.get("categoryId") ?? "");
    // DP-197: the saved visibility goes back unchanged (lib/listing-request).
    const body = listingSaveBody(listing, {
      categoryId,
      sortOrder: String(form.get("sortOrder") ?? "0"),
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      description: String(form.get("description") ?? ""),
    });
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
    setFieldsChanged(false);
    setCopied(false);
    if (notify) notify(listing ? "Listing saved." : `Listed on ${siteName}.`);
    else setSaved(true);
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={track}
      onChange={track}
      noValidate
      className="space-y-4"
    >
      {proposalHasText ? (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              Research proposal for {siteName}
              <span className="ml-1.5 font-normal text-ink-3">
                {proposal!.status === "APPROVED"
                  ? "· reviewed by the company"
                  : "· not reviewed by the company (optional)"}
              </span>
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={copyProposal}
                className={cx(buttonStyles.secondary, "h-9 px-3 text-xs")}
              >
                <Icon name="edit" size={14} />
                Copy into summary and description
              </button>
            ) : null}
          </div>
          {differs && !copied ? (
            <p className="flex items-start gap-1.5 text-amber-ink">
              <Icon name="alert" size={13} className="mt-px shrink-0" />
              The saved {siteName} text differs from the research proposal.
            </p>
          ) : null}
          {copied ? (
            <p className="flex items-start gap-1.5 text-petrol-strong" role="status">
              <Icon name="check" size={13} className="mt-px shrink-0" />
              Copied into the fields below. Edit it, then save the listing; nothing is saved yet.
            </p>
          ) : null}
          <p className="text-ink-3">
            Only the customer text is copied. Technical values held for verification stay in Company
            Review and never enter the specifications.
          </p>
          {proposal!.claimRisks.length ? (
            <details>
              <summary className="cursor-pointer font-medium text-amber-ink">
                {proposal!.claimRisks.length} claim note
                {proposal!.claimRisks.length === 1 ? "" : "s"}: wording that needs a certificate
              </summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-ink-2">
                {proposal!.claimRisks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {differs ? (
            <details>
              <summary className="cursor-pointer text-ink-2">Show the proposal text</summary>
              <div className="mt-1.5 space-y-1.5 whitespace-pre-line rounded-md bg-surface p-2 text-ink-2 ring-1 ring-inset ring-line">
                <p>
                  <span className="font-medium text-ink">Summary: </span>
                  {proposal!.summary ?? "—"}
                </p>
                <p>
                  <span className="font-medium text-ink">Description: </span>
                  {proposal!.description ?? "—"}
                </p>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={!canEdit} className="space-y-4">
        <legend className="sr-only">Listing on {siteName}</legend>
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
            ref={summaryRef}
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
            ref={descriptionRef}
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
        <div className="flex flex-wrap justify-end gap-2">
          {fieldsChanged ? (
            <button
              type="button"
              disabled={pending}
              onClick={discard}
              className={buttonStyles.ghost}
            >
              Discard changes
            </button>
          ) : null}
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            {pending ? <Spinner /> : <Icon name={listing ? "edit" : "plus"} size={17} />}
            <span>{pending ? "Saving…" : listing ? "Save listing" : `List on ${siteName}`}</span>
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
