"use client";

import {
  CATALOG_API,
  type Listing,
  type ListingSeoResponse,
  type ListingSeoUpdateRequest,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callCatalog, type FieldIssue } from "../../lib/catalog-client";
import { seoView, type SiteSeoDefaults } from "../../lib/seo-view";
import { Icon } from "../icons";
import { SeoFields, seoValues, type SeoValues } from "../seo/seo-fields";
import { SeoPreview } from "../seo/seo-preview";
import { buttonStyles, cx, Spinner } from "../ui";
import { Field, FIELD, FormMessage } from "./parts";
import { useNotice } from "./notices";
import { useUnsavedChanges } from "./product-tabs";

export interface SeoImageOption {
  id: string;
  label: string;
  isCover: boolean;
}

/**
 * DP-209: the product's SEO on one site (`product:edit` of the site). Saved on the listing, so it
 * reaches the site with the next publication, like the site's product text; saving never
 * publishes. Lengths are advice. A product that is not published or not shown is never indexed,
 * whatever is set here.
 */
export function ProductSeoForm({
  productId,
  siteId,
  siteName,
  listing,
  canEdit,
  productName,
  productSummary,
  path,
  images,
  siteSeo,
  origin,
}: {
  productId: string;
  siteId: string;
  siteName: string;
  listing: Listing;
  canEdit: boolean;
  /** The name the site shows (the site's title, else the shared name). */
  productName: string;
  productSummary: string | null;
  path: string;
  /** The product's public images (the OG image is one of them). */
  images: readonly SeoImageOption[];
  siteSeo: SiteSeoDefaults;
  origin: string | null;
}) {
  const imageSrc = (id: string) => `${CATALOG_API}/images/${id}/display`;
  const router = useRouter();
  const notify = useNotice();
  const [values, setValues] = useState<SeoValues>(() => seoValues(listing.seo));
  const [ogImageId, setOgImageId] = useState(listing.seo.ogImageId ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  useUnsavedChanges(canEdit && dirty);
  const readOnly = !canEdit;
  const invalid = (p: string) => issues.some((i) => i.path === p) || undefined;
  const cover = images.find((i) => i.isCover) ?? null;
  const fallbackTitle = `${productName} | ${siteSeo.siteName}`;
  const view = seoView(
    {
      ...values,
      path,
      fallbackTitle,
      fallbackDescription: productSummary,
      ogImageUrl: ogImageId ? imageSrc(ogImageId) : null,
      pageImageUrl: cover ? imageSrc(cover.id) : null,
    },
    siteSeo,
    origin,
  );
  const imageUrl =
    view.ogImageUrl.startsWith("/") && !view.ogImageUrl.startsWith("/api/")
      ? origin
        ? `${origin}${view.ogImageUrl}`
        : null
      : view.ogImageUrl;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const body: ListingSeoUpdateRequest = {
      version: listing.version,
      ...values,
      ogImageId: ogImageId || null,
    };
    setPending(true);
    setError(null);
    setIssues([]);
    const result = await callCatalog<ListingSeoResponse>(
      "POST",
      `/products/${productId}/listings/${siteId}/seo`,
      body,
    );
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setIssues(result.issues);
      return;
    }
    setDirty(false);
    if (notify) notify(`${siteName} SEO saved. Publish the product to show it on the site.`);
    router.refresh();
  }

  function discard() {
    setValues(seoValues(listing.seo));
    setOgImageId(listing.seo.ogImageId ?? "");
    setIssues([]);
    setError(null);
    setDirty(false);
  }

  return (
    <form
      onSubmit={save}
      noValidate
      className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
    >
      <div className="min-w-0 space-y-4">
        <SeoFields
          idPrefix={`product-seo-${siteId.slice(0, 8)}`}
          values={values}
          onChange={(patch) => {
            setValues({ ...values, ...patch });
            setDirty(true);
          }}
          readOnly={readOnly}
          invalid={invalid}
          pathPrefix=""
          titleFallback={`“${fallbackTitle}”`}
          descriptionFallback={
            productSummary ? "the product summary" : "the site's default description"
          }
          ogImage={
            <Field
              label="Open Graph image"
              htmlFor={`product-seo-${siteId.slice(0, 8)}-og-image`}
              hint="One of the product's public images. Empty: the cover, then the site's default image."
            >
              <select
                id={`product-seo-${siteId.slice(0, 8)}-og-image`}
                value={ogImageId}
                disabled={readOnly}
                aria-invalid={invalid("ogImageId")}
                onChange={(e) => {
                  setOgImageId(e.currentTarget.value);
                  setDirty(true);
                }}
                className={FIELD}
              >
                <option value="">Cover image (default)</option>
                {images.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
          }
        />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={buttonStyles.primary}>
              {pending ? <Spinner key="spin" /> : <Icon key="icon" name="check" size={17} />}
              <span>Save SEO</span>
            </button>
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={discard}
              className={buttonStyles.secondary}
            >
              <span>Discard changes</span>
            </button>
            <span className={cx("text-xs", dirty ? "text-amber-ink" : "text-ink-3")}>
              {dirty ? "Unsaved changes" : `Listing version ${listing.version}`}
            </span>
          </div>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
            Read only for you on this site.
          </p>
        )}
      </div>
      <SeoPreview
        view={view}
        siteName={siteSeo.siteName}
        imageSrc={imageUrl}
        noindex={values.noindex}
      />
    </form>
  );
}
