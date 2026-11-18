"use client";

import {
  BV_SITE_SEO_KEY,
  CMS_ARTICLE_FIELDS,
  CMS_ARTICLE_SECTION_TYPES,
  CMS_SECTION_TYPES,
  CMS_SECTIONS_MAX,
  cmsDesignTemplate,
  cmsIsArticle,
  cmsIsMenu,
  cmsMenuSchema,
  type CmsArticleDraftRequest,
  type CmsField,
  type CmsFixedDraftRequest,
  type CmsHistoryResponse,
  type CmsMenuTargetsResponse,
  type CmsPage,
  type CmsPageDraftRequest,
  type CmsPageResponse,
  type CmsSectionType,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { callCms, type FieldIssue } from "../../lib/cms-client";
import { Field, FIELD, FormMessage, TEXTAREA } from "../catalog/parts";
import { Fields, IconButton, move, toContent, toValues, type ItemValue } from "./field-form";
import { HistoryPanel } from "./history-panel";
import { MenuEditor, type MenuValue } from "./menu-editor";
import { PublicationPanel } from "./publication-panel";
import { useNotice } from "../catalog/notices";
import { SeoFields, seoValues, type SeoValues } from "../seo/seo-fields";
import { SeoPreview } from "../seo/seo-preview";
import { AddressSummary } from "../seo/address-summary";
import { previewImageSrc, seoView, type SiteSeoDefaults } from "../../lib/seo-view";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, Spinner } from "../ui";

interface SectionValue {
  id: string;
  type: string;
  values: ItemValue;
}

const SECTION_BY_TYPE = new Map(CMS_SECTION_TYPES.map((s) => [s.type, s]));
const ARTICLE_SECTIONS = CMS_SECTION_TYPES.filter((s) =>
  CMS_ARTICLE_SECTION_TYPES.includes(s.type),
);

function newSectionId(): string {
  return `sec-${crypto.randomUUID().slice(0, 8)}`;
}

function fromPage(page: CmsPage): SectionValue[] {
  const list = Array.isArray(page.content["sections"])
    ? (page.content["sections"] as ({ id: string; type: string } & Record<string, unknown>)[])
    : [];
  return list.map((s) => {
    const def = SECTION_BY_TYPE.get(s.type);
    return { id: s.id, type: s.type, values: def ? toValues(def.fields, s) : {} };
  });
}

/**
 * The draft editor of a CMS page (S1/S2, DP-015, DP-134).
 *  - TEMPLATE pages: title, slug, SEO and the ordered sections, each a form generated from the
 *    contracts field descriptors.
 *  - DESIGN pages and fragments: title, SEO and the fixed fields of their template; the layout,
 *    the order of the blocks and the motion stay in the site's code.
 *  - News articles (DP-020): title, slug under /news/, SEO, the summary and cover image, and the
 *    body as sections of the text-like types.
 *  - DP-219: the BV header and footer menus get their own editor (MenuEditor) instead of the
 *    generic field form; draft, preview, publication and history stay the same.
 * Saving replaces the whole draft and names the version it was based on. Publication, preview
 * and unpublishing are in the side panel (PublicationPanel); the publication history and the
 * restore of a revision below it (HistoryPanel).
 */
export function PageEditor({
  page,
  canEdit,
  canPublish,
  siteLabel,
  siteKey,
  history,
  origin = null,
  siteSeo,
  menuTargets = null,
}: {
  page: CmsPage;
  canEdit: boolean;
  canPublish: boolean;
  siteLabel: string;
  siteKey: "BV" | "CORPORATE";
  history: CmsHistoryResponse | null;
  /** DP-209: the site's public origin (canonical URL in the preview), null when unknown. */
  origin?: string | null;
  /** DP-209: the site defaults the site applies now (the preview's fallbacks). */
  siteSeo: SiteSeoDefaults;
  /** DP-219: what the menus may link to (null when it could not be loaded). */
  menuTargets?: CmsMenuTargetsResponse | null;
}) {
  const template = page.kind === "TEMPLATE" ? null : cmsDesignTemplate(page.templateKey);
  const article = cmsIsArticle(page);
  const sectionTypes = article ? ARTICLE_SECTIONS : CMS_SECTION_TYPES;
  const router = useRouter();
  const notify = useNotice();
  const readOnly = !canEdit;
  const [version, setVersion] = useState(page.version);
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug ?? "");
  // DP-209: title, description, canonical, noindex and Open Graph; fragments have none.
  const [seo, setSeo] = useState<SeoValues>(() => seoValues(page.seo));
  const [ogImage, setOgImage] = useState<ItemValue>(() => ({ ogImage: page.seo.ogImage ?? "" }));
  const hasSeo = page.kind !== "FRAGMENT";
  const [sections, setSections] = useState<SectionValue[]>(() => fromPage(page));
  const [design, setDesign] = useState<ItemValue>(() =>
    template ? toValues(template.fields, page.content) : {},
  );
  const menuKey = cmsIsMenu(page.templateKey) ? page.templateKey : null;
  // Version 1 content (label + href) is read as version 2: saving writes version 2.
  const [menu, setMenu] = useState<MenuValue | null>(() => {
    if (!menuKey) return null;
    const parsed = cmsMenuSchema(menuKey).safeParse(page.content);
    return parsed.success ? (parsed.data as MenuValue) : null;
  });
  const [articleValues, setArticleValues] = useState<ItemValue>(() =>
    article ? toValues(CMS_ARTICLE_FIELDS, page.content) : {},
  );
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
  const updateDesign = change(setDesign);
  const updateArticle = change(setArticleValues);
  const updateMenu = change(setMenu);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return;
    const seoBody = hasSeo
      ? { ...seo, ogImage: (ogImage["ogImage"] as string) || null }
      : { ...seoValues(page.seo), ogImage: page.seo.ogImage };
    const sectionContent = sections.map((s) => {
      const def = SECTION_BY_TYPE.get(s.type);
      return { id: s.id, type: s.type, ...(def ? toContent(def.fields, s.values) : {}) };
    });
    const body: CmsPageDraftRequest | CmsFixedDraftRequest | CmsArticleDraftRequest = template
      ? {
          version,
          title,
          seo: seoBody,
          content:
            menuKey && menu
              ? (menu as unknown as Record<string, unknown>)
              : toContent(template.fields, design),
        }
      : article
        ? {
            version,
            title,
            slug,
            seo: seoBody,
            content: {
              ...(toContent(CMS_ARTICLE_FIELDS, articleValues) as {
                excerpt: string;
                coverImage: string | null;
                coverAlt: string | null;
              }),
              sections: sectionContent,
            },
          }
        : { version, title, slug, seo: seoBody, content: { sections: sectionContent } };
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
            <Field label={article ? "Article title" : "Page title"} htmlFor="title">
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
            {template ? (
              <Field
                label="Address"
                htmlFor="path"
                hint="Fixed: the page is part of the site's design."
              >
                <input
                  id="path"
                  value={page.path ?? "Shown on every page (site-wide part)"}
                  readOnly
                  className={cx(FIELD, page.path ? "font-mono" : undefined)}
                />
              </Field>
            ) : (
              <Field label="Address" htmlFor="slug" hint="Changing it changes the page URL.">
                <div className="flex items-center">
                  <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-line-strong bg-surface-2 px-3 font-mono text-sm text-ink-3">
                    {article ? "/news/" : "/"}
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
            )}
          </div>
          {!template && page.path ? (
            <AddressSummary
              className="mt-4 border-t border-line pt-4"
              live={page.publication?.status === "PUBLISHED" ? page.publication.path : null}
              next={`${article ? "/news/" : "/"}${slug.trim().toLowerCase() || page.slug || ""}`}
              keepsOldAddress={page.keepsOldAddress}
              redirectsHere={page.redirectsHere}
            />
          ) : null}
        </Panel>

        {article ? (
          <Panel
            id="article-fields"
            title="Summary and cover"
            description="Shown on the news list and at the top of the article."
          >
            <div className="space-y-4">
              <Fields
                fields={CMS_ARTICLE_FIELDS}
                values={articleValues}
                path="content"
                idPrefix="article"
                readOnly={readOnly}
                invalid={invalid}
                onChange={(v) => updateArticle({ ...articleValues, ...v })}
                site={siteKey}
              />
            </div>
          </Panel>
        ) : null}

        {menuKey ? (
          menu ? (
            <MenuEditor
              key="menu"
              menuKey={menuKey}
              value={menu}
              targets={menuTargets}
              readOnly={readOnly}
              invalid={invalid}
              onChange={updateMenu}
            />
          ) : (
            <Panel key="menu-invalid" id="menu-invalid" title="Menu">
              <FormMessage kind="error">
                The draft of this menu does not match the menu fields. Restore a revision from the
                history to edit it.
              </FormMessage>
            </Panel>
          )
        ) : template ? (
          <DesignFields
            fields={template.fields}
            values={design}
            readOnly={readOnly}
            invalid={invalid}
            siteKey={siteKey}
            onChange={updateDesign}
          />
        ) : (
          <Panel
            id="sections"
            title={article ? "Article body" : "Sections"}
            description={`${sectionCount} of at most ${CMS_SECTIONS_MAX}. Shown on the ${article ? "article" : "page"} in this order.`}
          >
            {sections.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">
                {article
                  ? "No body yet. Add a Text section below; an article needs at least one section to be published."
                  : "No sections yet. Add the first one below; a page usually opens with a hero."}
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
                types={sectionTypes}
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
        )}
        {hasSeo ? (
          <PageSeoPanel
            pageId={page.id}
            path={page.path ?? "/"}
            fallbackTitle={page.path === "/" ? siteSeo.defaultTitle : title}
            fallbackDescription={
              article
                ? ((articleValues["excerpt"] as string | undefined) ?? null)
                : page.templateKey === "bv.news-index"
                  ? ((design["intro"] as string | undefined) ?? null)
                  : null
            }
            pageImage={
              article ? ((articleValues["coverImage"] as string | undefined) ?? null) : null
            }
            values={seo}
            ogImage={ogImage}
            readOnly={readOnly}
            invalid={invalid}
            siteKey={siteKey}
            siteSeo={siteSeo}
            origin={origin}
            onChange={(patch) => change(setSeo)({ ...seo, ...patch })}
            onOgImage={change(setOgImage)}
          />
        ) : page.templateKey === BV_SITE_SEO_KEY ? (
          <SiteSeoPreview values={design} origin={origin} />
        ) : null}
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
              Saving keeps the draft in the CMS; the site shows only what is published.
            </p>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            {!readOnly ? (
              <button
                type="submit"
                disabled={pending}
                className={cx(buttonStyles.primary, "w-full")}
              >
                {pending ? <Spinner /> : <Icon name="check" size={17} />}
                <span>Save draft</span>
              </button>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
                Read only for you on this site.
              </p>
            )}
          </div>
        </Panel>

        <PublicationPanel
          page={page}
          version={version}
          dirty={dirty}
          canPublish={canPublish}
          previewable={siteKey === "BV"}
        />

        <HistoryPanel
          pageId={page.id}
          version={version}
          dirty={dirty}
          canEdit={canEdit}
          history={history}
        />
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
  onChange: (values: ItemValue) => void;
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

function AddSection({
  types,
  disabled,
  onAdd,
}: {
  types: readonly CmsSectionType[];
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
        {types.map((def) => (
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

/**
 * The fixed fields of a designed page or fragment: each top-level group is its own panel (the
 * blocks of the page in their order on the site); the other top-level fields share one panel.
 */
function DesignFields({
  fields,
  values,
  readOnly,
  invalid,
  siteKey,
  onChange,
}: {
  fields: readonly CmsField[];
  values: ItemValue;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  siteKey: "BV" | "CORPORATE";
  onChange: (values: ItemValue) => void;
}) {
  const groups = fields.filter((f) => f.type === "group");
  const rest = fields.filter((f) => f.type !== "group");
  return (
    <>
      {rest.length ? (
        <Panel id="content-fields" title="Content">
          <div className="space-y-4">
            <Fields
              fields={rest}
              values={values}
              path="content"
              idPrefix="content"
              readOnly={readOnly}
              invalid={invalid}
              onChange={(v) => onChange({ ...values, ...v })}
              site={siteKey}
            />
          </div>
        </Panel>
      ) : null}
      {groups.map((g) =>
        g.type === "group" ? (
          <Panel key={g.key} id={`block-${g.key}`} title={g.label} description={g.hint}>
            <div className="space-y-4">
              <Fields
                fields={g.fields}
                values={(values[g.key] as ItemValue | null) ?? {}}
                path={`content.${g.key}`}
                idPrefix={g.key}
                readOnly={readOnly}
                invalid={invalid}
                onChange={(v) => onChange({ ...values, [g.key]: v })}
                site={siteKey}
              />
            </div>
          </Panel>
        ) : null,
      )}
    </>
  );
}

const OG_IMAGE_FIELD: CmsField = {
  type: "asset",
  key: "ogImage",
  label: "Open Graph image",
  kinds: ["image"],
  required: false,
  hint: "Empty: the page's own image, then the site's default image.",
};

/**
 * DP-209: the page's SEO with a live preview (search result, link preview, canonical URL and
 * length notes). Saved with the draft; the site shows it only after the page is published.
 */
function PageSeoPanel({
  pageId,
  path,
  fallbackTitle,
  fallbackDescription,
  pageImage,
  values,
  ogImage,
  readOnly,
  invalid,
  siteKey,
  siteSeo,
  origin,
  onChange,
  onOgImage,
}: {
  pageId: string;
  path: string;
  fallbackTitle: string;
  fallbackDescription: string | null;
  pageImage: string | null;
  values: SeoValues;
  ogImage: ItemValue;
  readOnly: boolean;
  invalid: (path: string) => true | undefined;
  siteKey: "BV" | "CORPORATE";
  siteSeo: SiteSeoDefaults;
  origin: string | null;
  onChange: (patch: Partial<SeoValues>) => void;
  onOgImage: (v: ItemValue) => void;
}) {
  const chosen = (ogImage["ogImage"] as string | undefined) || null;
  const view = seoView(
    {
      ...values,
      path,
      fallbackTitle,
      fallbackDescription,
      ogImageUrl: chosen,
      pageImageUrl: pageImage,
    },
    siteSeo,
    origin,
  );
  return (
    <Panel
      id="seo"
      title="SEO"
      description="Search results and link previews. Saved with the draft; the site shows it after publishing."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <SeoFields
          idPrefix={`seo-${pageId.slice(0, 8)}`}
          values={values}
          onChange={onChange}
          readOnly={readOnly}
          invalid={invalid}
          pathPrefix="seo."
          titleFallback={`“${fallbackTitle}”`}
          descriptionFallback={
            fallbackDescription ? "the page's summary" : "the site's default description"
          }
          ogImage={
            <Fields
              fields={[OG_IMAGE_FIELD]}
              values={ogImage}
              path="seo"
              idPrefix={`seo-${pageId.slice(0, 8)}`}
              readOnly={readOnly}
              invalid={invalid}
              onChange={(v) => onOgImage({ ...ogImage, ...v })}
              site={siteKey}
            />
          }
        />
        <SeoPreview
          view={view}
          siteName={siteSeo.siteName}
          imageSrc={previewImageSrc(view.ogImageUrl, origin)}
          noindex={values.noindex}
        />
      </div>
    </Panel>
  );
}

/** DP-209: the site defaults as a page without values of its own would show them. */
function SiteSeoPreview({ values, origin }: { values: ItemValue; origin: string | null }) {
  const text = (k: string) => ((values[k] as string | undefined) ?? "").trim();
  const site: SiteSeoDefaults = {
    siteName: text("siteName") || "Site name",
    defaultTitle: text("defaultTitle") || "Default title",
    defaultDescription: text("defaultDescription") || null,
    defaultOgImage: text("defaultOgImage") || "",
  };
  const view = seoView(
    {
      path: "/",
      fallbackTitle: site.defaultTitle,
      title: "",
      description: "",
      canonicalPath: "",
      noindex: false,
      ogTitle: "",
      ogDescription: "",
      ogImageUrl: null,
    },
    site,
    origin,
  );
  return (
    <Panel
      id="seo-defaults-preview"
      title="Preview"
      description="A page without its own SEO values, with these defaults (as the home page would show them)."
    >
      <SeoPreview
        view={view}
        siteName={site.siteName}
        imageSrc={site.defaultOgImage ? previewImageSrc(site.defaultOgImage, origin) : null}
        noindex={false}
      />
    </Panel>
  );
}
