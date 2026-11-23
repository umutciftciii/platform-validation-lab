"use client";

import { DESCRIPTION_MAX, type Category, type Listing, type SiteProposal } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { flattenTree } from "../../lib/catalog-view";
import { listingSaveBody } from "../../lib/listing-request";
import { formHasChanges } from "../../lib/product-tabs";
import { siteTextHint } from "../../lib/site-text";
import { useT } from "../i18n/locale-provider";
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
 *
 * DP-202: the site's own title, summary and description come first — they are what the site's
 * product page shows. Each field says whether the page uses it or, when it is empty, the shared
 * product content (the master), exactly as the API falls back. Category and sort order follow
 * as listing settings. The form saves the listing only; the master has its own form.
 */
export function ListingForm({
  productId,
  siteId,
  siteName,
  listing,
  categories,
  canEdit,
  proposal = null,
  shared,
}: {
  productId: string;
  siteId: string;
  siteName: string;
  listing: Listing | null;
  categories: readonly Category[];
  canEdit: boolean;
  /** DP-193: the site's research proposal, if any. */
  proposal?: SiteProposal | null;
  /** DP-202: the saved shared (master) texts a site falls back to; shown in the hints only. */
  shared?: { name: string; summary: string | null; description: string | null };
}) {
  const router = useRouter();
  const notify = useNotice();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const tree = flattenTree(categories);
  const defaultCategory = categories.find((c) => c.isDefault);
  const invalid = (path: string) => issues.some((i) => i.path === path) || undefined;
  // i18n-ignore: element id, not UI text
  const id = (name: string) => `listing-${siteId}-${name}`;
  // DP-187: unsaved edits mark the Content tab and are confirmed before a site switch.
  const [fieldsChanged, setFieldsChanged] = useState(false);
  useUnsavedChanges(canEdit && fieldsChanged);
  const track = (e: FormEvent<HTMLFormElement>) =>
    setFieldsChanged(formHasChanges(e.currentTarget));

  // DP-193: copy the research proposal into the fields (never saved by itself).
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
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
    if (notify) {
      notify(
        listing
          ? t("catalog.detail.listing.saved", { site: siteName })
          : t("catalog.detail.listing.listed", { site: siteName }),
      );
    } else setSaved(true);
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
      <fieldset disabled={!canEdit} className="space-y-4">
        <legend className="sr-only">
          {t("catalog.detail.listing.legend", { site: siteName })}
        </legend>
        <Field
          label={t("catalog.detail.listing.title")}
          htmlFor={id("title")}
          hint={siteTextHint("title", siteName, listing?.text?.title, shared?.name, t)}
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
        <Field
          label={t("catalog.detail.listing.summary")}
          htmlFor={id("summary")}
          hint={siteTextHint("summary", siteName, savedSummary, shared?.summary, t)}
        >
          <textarea
            ref={summaryRef}
            id={id("summary")}
            name="summary"
            rows={3}
            maxLength={500}
            defaultValue={listing?.text?.summary ?? ""}
            aria-invalid={invalid("summary")}
            onKeyDown={(e) => {
              // One line: Enter does not add a line break (the summary is a single sentence).
              if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
            }}
            className={cx(FIELD, "field-sizing-content h-auto min-h-16 py-2 leading-relaxed")}
          />
        </Field>
        <Field
          label={t("catalog.detail.listing.description")}
          htmlFor={id("description")}
          hint={siteTextHint("description", siteName, savedDescription, shared?.description, t)}
        >
          <textarea
            ref={descriptionRef}
            id={id("description")}
            name="description"
            rows={8}
            maxLength={DESCRIPTION_MAX}
            defaultValue={listing?.text?.description ?? ""}
            aria-invalid={invalid("description")}
            className={cx(TEXTAREA, "field-sizing-content min-h-48 max-h-[36rem]")}
          />
        </Field>
      </fieldset>
      {proposalHasText ? (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              {t("catalog.detail.listing.proposal.heading", { site: siteName })}
              <span className="ml-1.5 font-normal text-ink-3">
                {proposal!.status === "APPROVED"
                  ? t("catalog.detail.listing.proposal.reviewed")
                  : t("catalog.detail.listing.proposal.notReviewed")}
              </span>
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={copyProposal}
                className={cx(buttonStyles.secondary, "h-9 px-3 text-xs")}
              >
                <Icon name="edit" size={14} />
                {t("catalog.detail.listing.proposal.copy")}
              </button>
            ) : null}
          </div>
          {differs && !copied ? (
            <p className="flex items-start gap-1.5 text-amber-ink">
              <Icon name="alert" size={13} className="mt-px shrink-0" />
              {t("catalog.detail.listing.proposal.differs", { site: siteName })}
            </p>
          ) : null}
          {copied ? (
            <p className="flex items-start gap-1.5 text-petrol-strong" role="status">
              <Icon name="check" size={13} className="mt-px shrink-0" />
              {t("catalog.detail.listing.proposal.copied")}
            </p>
          ) : null}
          <p className="text-ink-3">{t("catalog.detail.listing.proposal.onlyText")}</p>
          {proposal!.claimRisks.length ? (
            <details>
              <summary className="cursor-pointer font-medium text-amber-ink">
                {t("catalog.detail.listing.proposal.claimNotes", {
                  count: proposal!.claimRisks.length,
                })}
              </summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-ink-2">
                {proposal!.claimRisks.map((risk, i) => (
                  <li key={i}>{risk}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {differs ? (
            <details>
              <summary className="cursor-pointer text-ink-2">
                {t("catalog.detail.listing.proposal.show")}
              </summary>
              <div className="mt-1.5 space-y-1.5 whitespace-pre-line rounded-md bg-surface p-2 text-ink-2 ring-1 ring-inset ring-line">
                <p>
                  <span className="font-medium text-ink">
                    {t("catalog.detail.listing.proposal.summary")}
                  </span>
                  {proposal!.summary ?? "—"}
                </p>
                <p>
                  <span className="font-medium text-ink">
                    {t("catalog.detail.listing.proposal.description")}
                  </span>
                  {proposal!.description ?? "—"}
                </p>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      <fieldset
        disabled={!canEdit}
        className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_8rem]"
      >
        <legend className="sr-only">
          {t("catalog.detail.listing.settings", { site: siteName })}
        </legend>
        <Field
          label={t("catalog.detail.listing.category.label")}
          htmlFor={id("category")}
          hint={
            listing
              ? undefined
              : defaultCategory
                ? t("catalog.detail.listing.category.hintDefault", { name: defaultCategory.name })
                : t("catalog.detail.listing.category.noDefault")
          }
        >
          <select
            id={id("category")}
            name="categoryId"
            defaultValue={listing?.categoryId ?? ""}
            aria-invalid={invalid("categoryId")}
            className={FIELD}
          >
            {listing ? null : (
              <option value="">{t("catalog.detail.listing.category.siteDefault")}</option>
            )}
            {tree.map(({ category, depth }) => (
              <option key={category.id} value={category.id}>
                {" ".repeat(depth)}
                {category.name}
                {category.isDefault ? t("catalog.detail.listing.category.defaultSuffix") : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("catalog.detail.listing.sortOrder")} htmlFor={id("sort")}>
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
      </fieldset>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {saved ? (
        <FormMessage kind="success">
          {t("catalog.detail.listing.saved", { site: siteName })}
        </FormMessage>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {fieldsChanged ? (
            <button
              type="button"
              disabled={pending}
              onClick={discard}
              className={buttonStyles.ghost}
            >
              {t("catalog.detail.listing.discard")}
            </button>
          ) : null}
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            {pending ? <Spinner /> : <Icon name={listing ? "edit" : "plus"} size={17} />}
            <span>
              {pending
                ? t("catalog.detail.listing.saving")
                : listing
                  ? t("catalog.detail.listing.save", { site: siteName })
                  : t("catalog.detail.listing.listOn", { site: siteName })}
            </span>
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Icon name="shield" size={16} />
          {t("catalog.detail.listing.readOnly")}
        </p>
      )}
    </form>
  );
}
