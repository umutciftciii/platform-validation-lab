"use client";

import { SEO_TEXT_LIMITS } from "@dream/contracts";
import type { ReactNode } from "react";
import type { Translate } from "../../lib/i18n/types";
import { Field, FIELD, TEXTAREA } from "../catalog/parts";
import { useT } from "../i18n/locale-provider";
import { cx } from "../ui";

/** DP-209: the SEO fields an editor fills (CMS pages and articles, BV product listings). */
export interface SeoValues {
  title: string;
  description: string;
  canonicalPath: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
}

export function seoValues(seo: {
  title: string | null;
  description: string | null;
  canonicalPath: string | null;
  noindex: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
}): SeoValues {
  return {
    title: seo.title ?? "",
    description: seo.description ?? "",
    canonicalPath: seo.canonicalPath ?? "",
    noindex: seo.noindex,
    ogTitle: seo.ogTitle ?? "",
    ogDescription: seo.ogDescription ?? "",
  };
}

const count = (t: Translate, v: string, recommended: number, max: number) =>
  t("catalog.detail.seoFields.counter", { length: v.trim().length, max, recommended });

/**
 * The fields themselves; lengths are counted, never enforced below the stored maximum (the
 * preview warns). `pathPrefix` maps the API's issue paths ("seo.title" or "title").
 */
export function SeoFields({
  idPrefix,
  values,
  onChange,
  readOnly,
  invalid,
  pathPrefix,
  titleFallback,
  descriptionFallback,
  ogImage,
}: {
  idPrefix: string;
  values: SeoValues;
  onChange: (patch: Partial<SeoValues>) => void;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  pathPrefix: "" | "seo.";
  /** What an empty SEO title falls back to (shown in the hint). */
  titleFallback: string;
  descriptionFallback: string;
  /** The Open Graph image chooser (a site asset for pages, a product image for products). */
  ogImage: ReactNode;
}) {
  const t = useT();
  const id = (name: string) => `${idPrefix}-${name}`;
  const L = SEO_TEXT_LIMITS;
  return (
    <div className="space-y-4">
      <Field
        label={t("catalog.detail.seoFields.title.label")}
        htmlFor={id("title")}
        hint={t("catalog.detail.seoFields.title.hint", {
          counter: count(t, values.title, L.title.recommended, L.title.max),
          fallback: titleFallback,
        })}
      >
        <input
          id={id("title")}
          maxLength={L.title.max}
          value={values.title}
          readOnly={readOnly}
          aria-invalid={invalid(`${pathPrefix}title`)}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
          className={FIELD}
        />
      </Field>
      <Field
        label={t("catalog.detail.seoFields.description.label")}
        htmlFor={id("description")}
        hint={t("catalog.detail.seoFields.description.hint", {
          counter: count(t, values.description, L.description.recommended, L.description.max),
          fallback: descriptionFallback,
        })}
      >
        <textarea
          id={id("description")}
          maxLength={L.description.max}
          rows={4}
          value={values.description}
          readOnly={readOnly}
          aria-invalid={invalid(`${pathPrefix}description`)}
          onChange={(e) => onChange({ description: e.currentTarget.value })}
          className={TEXTAREA}
        />
      </Field>
      <Field
        label={t("catalog.detail.seoFields.canonical.label")}
        htmlFor={id("canonical")}
        hint={t("catalog.detail.seoFields.canonical.hint")}
      >
        <input
          id={id("canonical")}
          maxLength={200}
          value={values.canonicalPath}
          readOnly={readOnly}
          spellCheck={false}
          placeholder="/"
          aria-invalid={invalid(`${pathPrefix}canonicalPath`)}
          onChange={(e) => onChange({ canonicalPath: e.currentTarget.value })}
          className={cx(FIELD, "font-mono text-sm")}
        />
      </Field>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={values.noindex}
          disabled={readOnly}
          onChange={(e) => onChange({ noindex: e.currentTarget.checked })}
          className="mt-0.5 size-4 accent-petrol"
        />
        <span>
          <span className="block">{t("catalog.detail.seoFields.noindex.label")}</span>
          <span className="block text-xs text-ink-3">
            {t("catalog.detail.seoFields.noindex.hint")}
          </span>
        </span>
      </label>
      <fieldset className="space-y-4 rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-medium text-ink">
          {t("catalog.detail.seoFields.og.legend")}
        </legend>
        <Field
          label={t("catalog.detail.seoFields.og.title")}
          htmlFor={id("og-title")}
          hint={t("catalog.detail.seoFields.og.titleHint", {
            counter: count(t, values.ogTitle, L.ogTitle.recommended, L.ogTitle.max),
          })}
        >
          <input
            id={id("og-title")}
            maxLength={L.ogTitle.max}
            value={values.ogTitle}
            readOnly={readOnly}
            aria-invalid={invalid(`${pathPrefix}ogTitle`)}
            onChange={(e) => onChange({ ogTitle: e.currentTarget.value })}
            className={FIELD}
          />
        </Field>
        <Field
          label={t("catalog.detail.seoFields.og.description")}
          htmlFor={id("og-description")}
          hint={t("catalog.detail.seoFields.og.descriptionHint", {
            counter: count(
              t,
              values.ogDescription,
              L.ogDescription.recommended,
              L.ogDescription.max,
            ),
          })}
        >
          <textarea
            id={id("og-description")}
            maxLength={L.ogDescription.max}
            rows={3}
            value={values.ogDescription}
            readOnly={readOnly}
            aria-invalid={invalid(`${pathPrefix}ogDescription`)}
            onChange={(e) => onChange({ ogDescription: e.currentTarget.value })}
            className={TEXTAREA}
          />
        </Field>
        {ogImage}
      </fieldset>
    </div>
  );
}
