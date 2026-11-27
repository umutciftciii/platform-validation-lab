/**
 * ML-13a (DP-244): the CMS part of a translation package — pages, news articles, menus and other
 * fragments of one site, with their title, address (TEMPLATE pages) and SEO texts.
 *
 *  - Source: the PUBLISHED revision of the group's page in the site's default language (the
 *    revision its publication points at). A newer draft is never a source; a page that is not live
 *    (never published, or unpublished) is not exported, and its units in a package are skipped
 *    (`outdated` `source_unpublished`). Export and import use the same rule. A designed page
 *    without an editable template is not exported either.
 *  - Import writes the draft of the group's page in the target language, or creates that page as
 *    a draft (owner decision 2026-11-25) from the source's structure with the translated texts
 *    (as "Create translation" does, ML-2). Its address must be free in the target language
 *    (database rule per site, language and path; DP-210 kept addresses) and unique in the package.
 *  - A translation whose structure differs from the source (sections, lists, images, links) gets
 *    no content text (conflict `structure`); its title, address and SEO texts still can.
 *  - The page records the source revision it now matches (clears "outdated") only when every
 *    source text of the page is verified by this import (written or already equal).
 *  - Nothing is published (no revision, no publication row).
 */
import {
  CMS_MENU_SCHEMA_VERSION,
  TRANSLATION_CMS_PAGE_FIELDS,
  cmsArticlePath,
  cmsContentTexts,
  cmsDesignTemplate,
  cmsIsArticle,
  cmsIsMenu,
  cmsPathForSlug,
  cmsSlugOfPath,
  cmsStructureWarnings,
  cmsTranslationDraft,
  cmsTranslationSlugSchema,
  cmsWithContentTexts,
  parseTranslationUnitKey,
  translationUnitKey,
  type CmsSite,
  type TranslationPackage,
  type TranslationPackagePage,
  type TranslationPageResult,
  type TranslationUnit,
} from "@dream/contracts";
import type { StaffAccess } from "../iam/staff/access.js";
import { asObject, contentIssuePaths, stableJson, type CmsDb } from "../cms/cms-content.js";
import { staleVersion } from "../cms/errors.js";
import { groupSource, newPageId, pageAddress } from "../cms/translations.js";
import { assertAddressFree } from "../seo/redirects.js";
import type { ScopedTx } from "../catalog/master.js";
import {
  decideUnit,
  issuePathOf,
  norm,
  normHash,
  textHash,
  textProblem,
  verified,
  writes,
  type UnitDecision,
} from "./units.js";

const PAGE_FIELDS = {
  id: true,
  kind: true,
  templateKey: true,
  path: true,
  locale: true,
  translationGroupId: true,
  translationSourceRevisionId: true,
  title: true,
  seoTitle: true,
  seoDescription: true,
  ogTitle: true,
  ogDescription: true,
  noindex: true,
  ogImage: true,
  content: true,
  version: true,
} as const;

interface PageRow {
  id: string;
  kind: "DESIGN" | "TEMPLATE" | "FRAGMENT";
  templateKey: string;
  path: string | null;
  locale: string;
  translationGroupId: string;
  translationSourceRevisionId: string | null;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  noindex: boolean;
  ogImage: string | null;
  content: unknown;
  version: number;
}

interface RevisionRow {
  id: string;
  pageId: string;
  revisionNumber: number;
  title: string;
  path: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  content: unknown;
}

type TextRow = Pick<
  RevisionRow,
  "title" | "path" | "seoTitle" | "seoDescription" | "ogTitle" | "ogDescription" | "content"
>;

interface Text {
  value: string | null;
  max: number | null;
  multiline: boolean;
}

export interface CmsEnv {
  siteId: string;
  site: Pick<CmsSite, "locale" | "locales">;
  defaultLocale: string;
  targetLocale: string;
  /** DP-210: the site keeps old addresses as redirects (BV). */
  keepsOldAddress: boolean;
  /** COM-2a (DP-320): the site's key, so content is checked with its own rules (its files). */
  siteKey?: CmsSite["key"];
}

/** Whether the page has a content schema the CMS can edit (else it stays managed in code). */
function translatable(page: { kind: string; templateKey: string }): boolean {
  return page.kind === "TEMPLATE" || cmsDesignTemplate(page.templateKey) !== undefined;
}

const schemaVersionOf = (templateKey: string) =>
  cmsIsMenu(templateKey) ? CMS_MENU_SCHEMA_VERSION : 1;

/** Every translatable text of a page or revision, keyed by unit field. */
function pageTexts(page: { kind: string; templateKey: string }, row: TextRow): Map<string, Text> {
  const out = new Map<string, Text>();
  const L = TRANSLATION_CMS_PAGE_FIELDS;
  out.set("title", { value: row.title, max: L.title, multiline: false });
  if (page.kind === "TEMPLATE" && row.path) {
    out.set("slug", { value: cmsSlugOfPath(row.path), max: L.slug, multiline: false });
  }
  out.set("seo.title", { value: row.seoTitle, max: L["seo.title"], multiline: false });
  out.set("seo.description", {
    value: row.seoDescription,
    max: L["seo.description"],
    multiline: true,
  });
  out.set("seo.ogTitle", { value: row.ogTitle, max: L["seo.ogTitle"], multiline: false });
  out.set("seo.ogDescription", {
    value: row.ogDescription,
    max: L["seo.ogDescription"],
    multiline: true,
  });
  for (const t of cmsContentTexts(page, asObject(row.content))) {
    out.set(`content.${t.path}`, { value: t.value, max: t.max, multiline: t.multiline });
  }
  return out;
}

async function loadGroups(db: CmsDb, env: CmsEnv, groupIds: readonly string[] | null) {
  const members = (await db.cmsPage.findMany({
    where: {
      siteId: env.siteId,
      ...(groupIds ? { translationGroupId: { in: [...groupIds] } } : {}),
    },
    select: PAGE_FIELDS,
    orderBy: [{ kind: "asc" }, { path: "asc" }, { title: "asc" }, { id: "asc" }],
  })) as PageRow[];
  const byGroup = new Map<string, PageRow[]>();
  for (const m of members) {
    const list = byGroup.get(m.translationGroupId) ?? [];
    list.push(m);
    byGroup.set(m.translationGroupId, list);
  }
  const sources = new Map<string, PageRow>();
  for (const [group, list] of byGroup) {
    const src = groupSource(list, env.defaultLocale);
    if (src && src.locale === env.defaultLocale && translatable(src)) sources.set(group, src);
  }
  const sourceIds = [...sources.values()].map((s) => s.id);
  // The source is the revision the site shows: the one the page's publication points at while it
  // is PUBLISHED. A later draft (saved, not published) is not a source; an unpublished or never
  // published page has none (owner decision 2026-11-25, PR #160 review). Export and import use
  // the same rule, so a source hash always names published text.
  const live = sourceIds.length
    ? await db.cmsPagePublication.findMany({
        where: { siteId: env.siteId, pageId: { in: sourceIds }, status: "PUBLISHED" },
        select: { pageId: true, revisionId: true },
      })
    : [];
  const liveId = new Map(live.map((p) => [p.pageId, p.revisionId]));
  const revisions = liveId.size
    ? ((await db.cmsPageRevision.findMany({
        where: { siteId: env.siteId, id: { in: [...liveId.values()] } },
        select: {
          id: true,
          pageId: true,
          revisionNumber: true,
          title: true,
          path: true,
          seoTitle: true,
          seoDescription: true,
          ogTitle: true,
          ogDescription: true,
          content: true,
        },
      })) as RevisionRow[])
    : [];
  /** The live (published) revision of each source page. */
  const published = new Map(revisions.map((r) => [r.pageId, r]));
  return { byGroup, sources, published };
}

function contextOf(env: CmsEnv, src: PageRow, rev: RevisionRow): string {
  const where =
    src.kind === "TEMPLATE" && rev.path
      ? pageAddress(env.site, env.defaultLocale, rev.path)
      : src.templateKey;
  return `${where} · ${rev.title}`.slice(0, 400);
}

// --- export -----------------------------------------------------------------------------------

export async function exportCms(
  db: CmsDb,
  env: CmsEnv,
): Promise<{ pages: TranslationPackagePage[]; units: TranslationUnit[] }> {
  const { byGroup, sources, published } = await loadGroups(db, env, null);
  const pages: TranslationPackagePage[] = [];
  const units: TranslationUnit[] = [];
  for (const [groupId, src] of sources) {
    const rev = published.get(src.id);
    if (!rev) continue; // not live (never published or unpublished): out of scope
    const tgt = byGroup.get(groupId)?.find((p) => p.locale === env.targetLocale);
    const targetTexts = tgt ? pageTexts(tgt, tgt) : null;
    const context = contextOf(env, src, rev);
    const before = units.length;
    for (const [field, text] of pageTexts(src, rev)) {
      const source = norm(text.value);
      if (source === null) continue;
      const current = norm(targetTexts?.get(field)?.value);
      units.push({
        key: translationUnitKey("cms", groupId, field),
        kind: "cms",
        context,
        maxLength: text.max,
        multiline: text.multiline,
        source,
        sourceHash: textHash(source),
        current,
        currentHash: normHash(current),
        target: null,
      });
    }
    if (units.length === before) continue;
    pages.push({
      groupId,
      sourcePageId: src.id,
      sourceRevisionNumber: rev.revisionNumber,
      kind: src.kind,
      templateKey: src.templateKey,
      path: src.path,
      targetPageId: tgt?.id ?? null,
    });
  }
  return { pages, units };
}

// --- import plan --------------------------------------------------------------------------------

interface CmsPagePlan {
  page: TranslationPageResult;
  create?: {
    src: PageRow;
    rev: RevisionRow;
    path: string | null;
    title: string;
    seo: Record<"seoTitle" | "seoDescription" | "ogTitle" | "ogDescription", string | null>;
    content: Record<string, unknown>;
  };
  update?: {
    tgt: PageRow;
    data: Record<string, unknown>;
    changed: string[];
    pathChanged: boolean;
  };
}

export interface CmsPlan {
  decisions: Map<string, UnitDecision>;
  pages: CmsPagePlan[];
}

const SEO_COLUMN = {
  "seo.title": "seoTitle",
  "seo.description": "seoDescription",
  "seo.ogTitle": "ogTitle",
  "seo.ogDescription": "ogDescription",
} as const;

/** What the import of the package's CMS units would write (reads only). */
export async function planCms(db: CmsDb, env: CmsEnv, pkg: TranslationPackage): Promise<CmsPlan> {
  const decisions = new Map<string, UnitDecision>();
  const pages: CmsPagePlan[] = [];
  const unitsByGroup = new Map<string, { unit: TranslationUnit; field: string }[]>();
  for (const unit of pkg.units) {
    if (unit.kind !== "cms") continue;
    const k = parseTranslationUnitKey(unit.key);
    if (!k) continue; // the schema refuses such a package
    const list = unitsByGroup.get(k.id) ?? [];
    list.push({ unit, field: k.field });
    unitsByGroup.set(k.id, list);
  }
  if (pkg.pages.length === 0) return { decisions, pages };
  const { byGroup, sources, published } = await loadGroups(
    db,
    env,
    pkg.pages.map((p) => p.groupId),
  );
  // Addresses and designed pages already taken in the target language (any group).
  const taken = await db.cmsPage.findMany({
    where: { siteId: env.siteId, locale: env.targetLocale },
    select: { id: true, path: true, kind: true, templateKey: true },
  });
  const claimed = new Set<string>();

  for (const meta of pkg.pages) {
    const units = unitsByGroup.get(meta.groupId) ?? [];
    const decide = (key: string, d: UnitDecision) => decisions.set(key, d);
    const skipAll = (rule: string, status: UnitDecision["status"] = "not_found") => {
      for (const { unit } of units) decide(unit.key, { status, rule });
      pages.push({
        page: { groupId: meta.groupId, targetPageId: null, action: "skipped", rule },
      });
    };
    const src = sources.get(meta.groupId);
    if (!src) {
      skipAll("page_missing");
      continue;
    }
    const rev = published.get(src.id);
    if (!rev) {
      // The source page was taken off the site since the export: its texts are not a source.
      skipAll("source_unpublished", "outdated");
      continue;
    }
    const article = cmsIsArticle(src);
    const sourceTexts = pageTexts(src, rev);
    const tgt = byGroup.get(meta.groupId)?.find((p) => p.locale === env.targetLocale);
    const targetTexts = tgt ? pageTexts(tgt, tgt) : null;
    const structureOk =
      !tgt || cmsStructureWarnings(asObject(rev.content), asObject(tgt.content)).length === 0;

    for (const { unit, field } of units) {
      const text = sourceTexts.get(field);
      const target = norm(unit.target);
      let problem: string | null = null;
      if (target !== null) {
        if (field === "slug") {
          const parsed = cmsTranslationSlugSchema(article).safeParse(target);
          problem = parsed.success
            ? parsed.data === target
              ? null
              : "format"
            : (parsed.error.issues[0]?.message ?? "format");
        } else {
          const max =
            field in TRANSLATION_CMS_PAGE_FIELDS
              ? TRANSLATION_CMS_PAGE_FIELDS[field as keyof typeof TRANSLATION_CMS_PAGE_FIELDS]
              : (text?.max ?? null);
          problem = textProblem(target, max);
        }
      }
      let d = decideUnit({
        sourceHash: unit.sourceHash,
        sourceNow: norm(text?.value),
        target,
        problem,
        currentHash: unit.currentHash,
        currentNow: norm(targetTexts?.get(field)?.value),
      });
      // A content text the translation does not have in the same place: its structure differs.
      if (
        writes(d) &&
        tgt &&
        field.startsWith("content.") &&
        (!structureOk || !targetTexts?.has(field))
      ) {
        d = { status: "conflict", rule: "structure" };
      }
      decide(unit.key, d);
    }

    const writing = () => units.filter(({ unit }) => writes(decisions.get(unit.key)));
    const refuse = (rule: string, status: UnitDecision["status"]) => {
      for (const { unit } of writing()) decide(unit.key, { status, rule });
    };
    const valueOf = (field: string): string | null => {
      const u = units.find((x) => x.field === field);
      return u && writes(decisions.get(u.unit.key)) ? norm(u.unit.target) : null;
    };

    if (writing().length === 0) {
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: tgt?.id ?? null,
          action: tgt ? "unchanged" : "skipped",
          rule: tgt ? null : "nothing_to_write",
        },
      });
      continue;
    }
    if (!tgt && valueOf("title") === null) {
      // A new page needs its title in the target language.
      refuse("title_required", "invalid");
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: null,
          action: "skipped",
          rule: "title_required",
        },
      });
      continue;
    }
    if (!tgt && src.kind !== "TEMPLATE" && taken.some((t) => t.templateKey === src.templateKey)) {
      // A designed page or fragment exists once per language (registry key).
      refuse("registry_taken", "conflict");
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: null,
          action: "skipped",
          rule: "registry_taken",
        },
      });
      continue;
    }

    // The address in the target language: the translated slug, else the page's own or the
    // source's (TEMPLATE pages); designed pages and fragments keep their registry address.
    const slugUnit = units.find((x) => x.field === "slug");
    const pathFor = (slug: string | null): string | null => {
      if (src.kind !== "TEMPLATE" || !rev.path) return tgt ? tgt.path : src.path;
      const s = slug ?? (tgt?.path ? cmsSlugOfPath(tgt.path) : cmsSlugOfPath(rev.path));
      return article ? cmsArticlePath(s) : cmsPathForSlug(s);
    };
    const addressProblem = async (path: string | null): Promise<string | null> => {
      if (path === null || (tgt && path === tgt.path)) return null;
      if (claimed.has(path)) return "duplicate_slug";
      if (taken.some((t) => t.path === path && t.id !== tgt?.id)) return "slug_taken";
      if (env.keepsOldAddress) {
        try {
          await assertAddressFree(
            db as ScopedTx,
            env.siteId,
            pageAddress(env.site, env.targetLocale, path),
            "CMS_PAGE",
            tgt?.id ?? null,
          );
        } catch {
          return "old_address";
        }
      }
      return null;
    };
    let path = pathFor(valueOf("slug"));
    let problem = await addressProblem(path);
    if (problem && slugUnit && writes(decisions.get(slugUnit.unit.key))) {
      decide(slugUnit.unit.key, { status: "conflict", rule: problem });
      path = pathFor(null);
      problem = await addressProblem(path);
    }
    if (problem) {
      refuse(problem === "duplicate_slug" ? problem : "path_taken", "conflict");
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: tgt?.id ?? null,
          action: "skipped",
          rule: problem,
        },
      });
      continue;
    }

    // Content: the translated texts into the translation's draft (or the source's structure).
    const base = tgt ? asObject(tgt.content) : cmsTranslationDraft(src, asObject(rev.content));
    const contentUnits = () => writing().filter(({ field }) => field.startsWith("content."));
    const build = () =>
      cmsWithContentTexts(
        src,
        base,
        new Map(
          contentUnits().map(({ unit, field }) => [
            field.slice("content.".length),
            norm(unit.target) as string,
          ]),
        ),
      );
    let content = build();
    const issues = contentIssuePaths(src.kind, src.templateKey, content, env.siteKey) ?? [];
    let refused = false;
    for (const { unit, field } of contentUnits()) {
      const at = issuePathOf(field.slice("content.".length), content);
      if (issues.some((i) => i === at || i.startsWith(`${at}.`))) {
        decide(unit.key, { status: "invalid", rule: "schema" });
        refused = true;
      }
    }
    if (refused) content = build();
    if (writing().length === 0) {
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: tgt?.id ?? null,
          action: tgt ? "unchanged" : "skipped",
          rule: tgt ? null : "nothing_to_write",
        },
      });
      continue;
    }
    if (!tgt && valueOf("title") === null) {
      refuse("title_required", "invalid");
      pages.push({
        page: {
          groupId: meta.groupId,
          targetPageId: null,
          action: "skipped",
          rule: "title_required",
        },
      });
      continue;
    }
    if (path) claimed.add(path);

    const seo = {} as Record<(typeof SEO_COLUMN)[keyof typeof SEO_COLUMN], string | null>;
    for (const [field, column] of Object.entries(SEO_COLUMN)) {
      seo[column] = valueOf(field) ?? (tgt ? tgt[column] : null);
    }
    // Every source text of the page verified by this import → the translation matches `rev`.
    const complete = [...sourceTexts].every(
      ([field, text]) =>
        norm(text.value) === null ||
        verified(decisions.get(units.find((u) => u.field === field)?.unit.key ?? "")),
    );

    if (!tgt) {
      pages.push({
        page: { groupId: meta.groupId, targetPageId: null, action: "create", rule: null },
        create: { src, rev, path, title: valueOf("title") as string, seo, content },
      });
      continue;
    }
    const next: Record<string, unknown> = {
      title: valueOf("title") ?? tgt.title,
      path,
      ...seo,
      content: stableJson(content),
      translationSourceRevisionId: complete ? rev.id : tgt.translationSourceRevisionId,
    };
    const old: Record<string, unknown> = {
      title: tgt.title,
      path: tgt.path,
      seoTitle: tgt.seoTitle,
      seoDescription: tgt.seoDescription,
      ogTitle: tgt.ogTitle,
      ogDescription: tgt.ogDescription,
      content: stableJson(tgt.content),
      translationSourceRevisionId: tgt.translationSourceRevisionId,
    };
    const changed = Object.keys(next).filter((k) => next[k] !== old[k]);
    if (changed.length === 0) {
      pages.push({
        page: { groupId: meta.groupId, targetPageId: tgt.id, action: "unchanged", rule: null },
      });
      continue;
    }
    const data: Record<string, unknown> = {};
    for (const k of changed) data[k] = k === "content" ? content : next[k];
    pages.push({
      page: { groupId: meta.groupId, targetPageId: tgt.id, action: "update", rule: null },
      update: { tgt, data, changed, pathChanged: changed.includes("path") },
    });
  }
  return { decisions, pages };
}

// --- import -------------------------------------------------------------------------------------

/** Writes the plan's drafts (inside the import transaction). Returns created/updated counts. */
export async function applyCms(
  tx: ScopedTx,
  a: StaffAccess,
  env: CmsEnv,
  plan: CmsPlan,
  o: { now: Date; digest: string },
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const p of plan.pages) {
    if (p.create) {
      const c = p.create;
      if (c.path && env.keepsOldAddress) {
        await assertAddressFree(
          tx,
          env.siteId,
          pageAddress(env.site, env.targetLocale, c.path),
          "CMS_PAGE",
          null,
        );
      }
      const pageId = newPageId(o.now.getTime());
      await tx.cmsPage.create({
        data: {
          id: pageId,
          translationGroupId: c.src.translationGroupId,
          translationSourceRevisionId: c.rev.id,
          siteId: env.siteId,
          kind: c.src.kind,
          templateKey: c.src.templateKey,
          path: c.path,
          locale: env.targetLocale,
          title: c.title,
          ...c.seo,
          // As "Create translation": the switch and the image stay (the canonical is per address).
          noindex: c.src.noindex,
          canonicalPath: null,
          ogImage: c.src.ogImage,
          content: c.content as never,
          schemaVersion: schemaVersionOf(c.src.templateKey),
          createdById: a.userId,
          updatedById: a.userId,
        },
        select: { id: true },
      });
      p.page.targetPageId = pageId;
      await a.audit(tx, {
        action: "cms.translation_created",
        resourceType: "cms_page",
        resourceId: pageId,
        siteId: env.siteId,
        permission: "content:edit",
        metadata: {
          locale: env.targetLocale,
          fromPageId: c.src.id,
          fromLocale: env.defaultLocale,
          templateKey: c.src.templateKey,
          path: c.path,
          sourceRevisionNumber: c.rev.revisionNumber,
          origin: "translation_package",
          digest: o.digest,
        },
      });
      created += 1;
    } else if (p.update) {
      const u = p.update;
      if (u.pathChanged && u.data["path"] && env.keepsOldAddress) {
        await assertAddressFree(
          tx,
          env.siteId,
          pageAddress(env.site, env.targetLocale, u.data["path"] as string),
          "CMS_PAGE",
          u.tgt.id,
        );
      }
      const res = await tx.cmsPage.updateMany({
        where: { id: u.tgt.id, version: u.tgt.version },
        data: { ...u.data, updatedById: a.userId, version: { increment: 1 } } as never,
      });
      if (res.count !== 1) throw staleVersion();
      await a.audit(tx, {
        action: "cms.translation_imported",
        resourceType: "cms_page",
        resourceId: u.tgt.id,
        siteId: env.siteId,
        permission: "content:edit",
        metadata: {
          locale: env.targetLocale,
          changed: u.changed,
          version: u.tgt.version + 1,
          origin: "translation_package",
          digest: o.digest,
        },
      });
      updated += 1;
    }
  }
  return { created, updated };
}
