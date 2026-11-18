/**
 * DP-211 (ADR-024 D9): redirect management of the BV site on the DP-210 table `SiteRedirect`
 * (contract and rules: @dream/contracts `admin/seo-redirects.ts`).
 *
 * Authorization, existing permissions only (no new permission, no approval step):
 *  - read: `content:read` or `product:read` of the site (like the SEO overview);
 *  - create, edit, delete, import: `content:publish` of the site. A manual redirect changes the
 *    live site at once, so it needs the right to change the live site; no second approval.
 *  - history: `audit:read` of the site, read in the caller's database context (row-level
 *    security on AuditEvent decides again).
 * A refusal is audited (DENIED) by StaffAccess.require. Sites whose frontend applies no
 * redirects (Corporate) answer 404.
 *
 * Every write runs in one transaction that first locks the site's addresses (DP-210
 * `lockSitePaths`), the same lock CMS and product publications take: a publication and a redirect
 * change never interleave, so "a redirect never starts at live content" and "no chain" are
 * checked against a complete, current picture. The database trigger `SiteRedirect_no_chain`
 * stays the last line for every writer.
 *
 * Audit events name paths, status, state and origin only; a note's text is never copied (only
 * whether it changed).
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  REDIRECT_SITE_KEYS,
  SEO_REDIRECT_PAGE_SIZE,
  SeoRedirectCreateRequestSchema,
  SeoRedirectDeleteRequestSchema,
  SeoRedirectImportRequestSchema,
  SeoRedirectListQuerySchema,
  SeoRedirectUpdateRequestSchema,
  parseCsvActive,
  parseCsvStatus,
  parseRedirectCsv,
  parseRedirectSource,
  parseRedirectTarget,
  redirectSourceLabel,
  redirectTargetPath,
  type SeoRedirectHistoryResponse,
  type SeoRedirectImportResponse,
  type SeoRedirectImportRow,
  type SeoRedirectItem,
  type SeoRedirectListResponse,
  type SeoRedirectResponse,
  type SeoRedirectWarning,
} from "@dream/contracts";
import type { RequestContext } from "../iam/http/request-context.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import type { ScopedTx } from "../catalog/master.js";
import { liveAddresses } from "./public-seo.service.js";
import { lockSitePaths, redirectDbError } from "./redirects.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SITE = "00000000-0000-0000-0000-000000000000";
const RESOURCE = "site_redirect";
const MANAGE = "content:publish";
const HISTORY = "audit:read";
/** App pages that always answer (not CMS content): never "target not live". */
const ALWAYS_LIVE = new Set(["/products"]);
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

type Issue = { path: string; rule: string };

interface Row {
  id: string;
  sourcePath: string;
  sourceQuery: string;
  target: string;
  statusCode: number;
  active: boolean;
  origin: "MANUAL" | "SLUG_CHANGE" | "IMPORT";
  contentType: "CMS_PAGE" | "PRODUCT" | null;
  contentId: string | null;
  note: string | null;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

const ROW_SELECT = {
  id: true,
  sourcePath: true,
  sourceQuery: true,
  target: true,
  statusCode: true,
  active: true,
  origin: true,
  contentType: true,
  contentId: true,
  note: true,
  version: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** What a redirect will be after a change (the values the checks look at). */
interface Planned {
  /** Existing row id, or null for a new one. */
  id: string | null;
  sourcePath: string;
  sourceQuery: string;
  target: string;
  statusCode: 301 | 302;
  active: boolean;
}

const keyOf = (r: { sourcePath: string; sourceQuery: string }) =>
  `${r.sourcePath}?${r.sourceQuery}`;

/** Thrown inside a transaction to roll it back with a refusal. */
const conflict = (details: Issue[]) => new ApiError("CONFLICT_STATE", details);

/**
 * The chain rules over a complete set of active redirects (after a change): a target is never an
 * active plain source, a plain source never an active target. Issues for `subject`.
 */
function chainIssues(subject: Planned, active: readonly Planned[]): Issue[] {
  if (!subject.active) return [];
  const issues: Issue[] = [];
  const others = active.filter((r) => keyOf(r) !== keyOf(subject));
  const targetPath = redirectTargetPath(subject.target);
  if (others.some((r) => r.sourceQuery === "" && r.sourcePath === targetPath)) {
    issues.push({ path: "target", rule: "chain" });
  }
  if (
    subject.sourceQuery === "" &&
    others.some((r) => redirectTargetPath(r.target) === subject.sourcePath)
  ) {
    issues.push({ path: "source", rule: "chain" });
  }
  return issues;
}

function mapDbError(e: unknown): never {
  if (e instanceof ApiError) throw e;
  const text =
    e instanceof Error
      ? `${e.message}\n${JSON.stringify((e as { meta?: unknown }).meta ?? {})}`
      : String(e);
  if (/seo: a redirect target cannot be/.test(text))
    throw conflict([{ path: "target", rule: "chain" }]);
  if (/seo: a redirect source cannot be/.test(text))
    throw conflict([{ path: "source", rule: "chain" }]);
  const mapped = redirectDbError(text);
  if (mapped) throw mapped;
  if ((e as { code?: unknown }).code === "P2002" || /unique constraint/i.test(text)) {
    throw conflict([{ path: "source", rule: "duplicate" }]);
  }
  if ((e as { code?: unknown }).code === "P2025")
    throw conflict([{ path: "version", rule: "stale" }]);
  throw e;
}

@Injectable()
export class AdminRedirectsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** The caller, the site (BV only) and its scoped client, after the permission check. */
  private async begin(ctx: RequestContext, rawSiteId: string, need: "read" | "manage" | "history") {
    const a = await this.access.begin(ctx);
    const siteId = UUID.test(rawSiteId) ? rawSiteId.toLowerCase() : NO_SITE;
    const target = { scope: "site" as const, siteId };
    const resource = { type: RESOURCE, id: null };
    if (need === "manage") await a.require(MANAGE, target, resource);
    else if (need === "history") await a.require(HISTORY, target, resource);
    else if (
      !a.sitesWith("content:read").includes(siteId) &&
      !a.sitesWith("product:read").includes(siteId)
    ) {
      await a.require("content:read", target, resource);
    }
    const site = a.sites.find((s) => s.id === siteId);
    if (!site) throw new ApiError("NOT_FOUND");
    if (!REDIRECT_SITE_KEYS.includes(site.key)) {
      throw new ApiError("NOT_FOUND", [{ path: "site", rule: "no_redirects" }]);
    }
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    return { a, site, siteId, db };
  }

  private static live(db: SiteScopedClient | ScopedTx, siteId: string): Promise<Set<string>> {
    return liveAddresses({ db: db as SiteScopedClient, siteId });
  }

  /** Whether a page or product that is not live uses the address (it would take it back). */
  private static async draftAt(db: SiteScopedClient | ScopedTx, siteId: string, path: string) {
    const d = db as SiteScopedClient;
    if (path.startsWith("/products/")) {
      const slug = path.slice("/products/".length);
      return (await d.product.count({ where: { slug, status: { not: "ARCHIVED" } } })) > 0;
    }
    return (await d.cmsPage.count({ where: { siteId, path } })) > 0;
  }

  private static async warningsFor(
    db: SiteScopedClient | ScopedTx,
    siteId: string,
    p: Planned,
    live: Set<string>,
  ): Promise<SeoRedirectWarning[]> {
    const warnings: SeoRedirectWarning[] = [];
    const targetPath = redirectTargetPath(p.target);
    if (!live.has(targetPath) && !ALWAYS_LIVE.has(targetPath)) warnings.push("target:not_live");
    if (await AdminRedirectsService.draftAt(db, siteId, p.sourcePath)) {
      warnings.push("source:draft_content");
    }
    return warnings;
  }

  private async items(
    a: StaffAccess,
    db: SiteScopedClient,
    siteId: string,
    rows: readonly Row[],
  ): Promise<SeoRedirectItem[]> {
    const names = await a.staffNames(rows.flatMap((r) => [r.createdById, r.updatedById]));
    const pageIds = rows.filter((r) => r.contentType === "CMS_PAGE").map((r) => r.contentId!);
    const productIds = rows.filter((r) => r.contentType === "PRODUCT").map((r) => r.contentId!);
    const readPages = a.sitesWith("content:read").includes(siteId);
    const readProducts = a.sitesWith("product:read").includes(siteId);
    const [pages, products, live] = await Promise.all([
      readPages && pageIds.length
        ? db.cmsPage.findMany({
            where: { siteId, id: { in: pageIds } },
            select: { id: true, title: true },
          })
        : [],
      readProducts && productIds.length
        ? db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [],
      rows.some((r) => r.contentId) ? AdminRedirectsService.live(db, siteId) : new Set<string>(),
    ]);
    return rows.map((r) => {
      const targetPath = redirectTargetPath(r.target);
      const name =
        r.contentType === "CMS_PAGE"
          ? (pages.find((p) => p.id === r.contentId)?.title ?? null)
          : r.contentType === "PRODUCT"
            ? (products.find((p) => p.id === r.contentId)?.name ?? null)
            : null;
      return {
        id: r.id,
        sourcePath: r.sourcePath,
        sourceQuery: r.sourceQuery,
        target: r.target,
        statusCode: r.statusCode === 302 ? 302 : 301,
        active: r.active,
        origin: r.origin,
        note: r.note,
        version: r.version,
        protected: r.origin === "SLUG_CHANGE",
        content:
          r.contentType && r.contentId
            ? {
                type: r.contentType,
                id: r.contentId,
                name,
                livePath: live.has(targetPath) ? targetPath : null,
              }
            : null,
        createdBy: names.get(r.createdById) ?? null,
        updatedBy: names.get(r.updatedById) ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async list(
    ctx: RequestContext,
    rawSiteId: string,
    rawQuery: unknown,
  ): Promise<SeoRedirectListResponse> {
    const { a, site, siteId, db } = await this.begin(ctx, rawSiteId, "read");
    const q = parseBody(SeoRedirectListQuerySchema, rawQuery);
    const text = q.q.toLowerCase();
    const where = {
      siteId,
      ...(q.origin ? { origin: q.origin } : {}),
      ...(q.status ? { statusCode: Number(q.status) } : {}),
      ...(q.active ? { active: q.active === "true" } : {}),
      ...(text
        ? {
            OR: [
              { sourcePath: { contains: text, mode: "insensitive" as const } },
              { sourceQuery: { contains: text, mode: "insensitive" as const } },
              { target: { contains: text, mode: "insensitive" as const } },
              { note: { contains: text, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const field = {
      updated: "updatedAt",
      created: "createdAt",
      source: "sourcePath",
      target: "target",
    }[q.sort];
    const [total, rows, byOrigin, inactive] = await Promise.all([
      db.siteRedirect.count({ where }),
      db.siteRedirect.findMany({
        where,
        orderBy: [{ [field]: q.dir }, { sourceQuery: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * SEO_REDIRECT_PAGE_SIZE,
        take: SEO_REDIRECT_PAGE_SIZE,
        select: ROW_SELECT,
      }),
      db.siteRedirect.groupBy({ by: ["origin"], where: { siteId }, _count: { _all: true } }),
      db.siteRedirect.count({ where: { siteId, active: false } }),
    ]);
    const count = (o: string) => byOrigin.find((g) => g.origin === o)?._count._all ?? 0;
    return {
      site: { id: site.id, key: site.key, name: site.name },
      permissions: {
        manage: a.allows(MANAGE, { scope: "site", siteId }),
        history: a.allows(HISTORY, { scope: "site", siteId }),
      },
      items: await this.items(a, db, siteId, rows as Row[]),
      total,
      page: q.page,
      pageSize: SEO_REDIRECT_PAGE_SIZE,
      counts: {
        all: count("MANUAL") + count("SLUG_CHANGE") + count("IMPORT"),
        MANUAL: count("MANUAL"),
        SLUG_CHANGE: count("SLUG_CHANGE"),
        IMPORT: count("IMPORT"),
        inactive,
      },
    };
  }

  /** Source and target in stored form, or 400 with every field's rule. */
  private static parseAddresses(source: string, target: string) {
    const s = parseRedirectSource(source);
    const t = parseRedirectTarget(target);
    const issues: Issue[] = [];
    if (!s.ok) issues.push({ path: "source", rule: s.rule });
    if (!t.ok) issues.push({ path: "target", rule: t.rule });
    if (
      s.ok &&
      t.ok &&
      s.value.sourceQuery === "" &&
      redirectTargetPath(t.value) === s.value.sourcePath
    ) {
      issues.push({ path: "target", rule: "self" });
    }
    if (issues.length || !s.ok || !t.ok) throw new ApiError("VALIDATION_FAILED", issues);
    return { ...s.value, target: t.value };
  }

  /** The conflicts of one planned redirect against the site's current rows and live content. */
  private static async conflicts(tx: ScopedTx, siteId: string, p: Planned, live: Set<string>) {
    const issues: Issue[] = [];
    const same = await tx.siteRedirect.findUnique({
      where: {
        siteId_sourcePath_sourceQuery: {
          siteId,
          sourcePath: p.sourcePath,
          sourceQuery: p.sourceQuery,
        },
      },
      select: { id: true },
    });
    if (same && same.id !== p.id) issues.push({ path: "source", rule: "duplicate" });
    // A switched-off redirect at a live address is history (DP-210 rule 1), never applied.
    if (p.active && live.has(p.sourcePath)) issues.push({ path: "source", rule: "live_content" });
    if (p.active) {
      const active = await tx.siteRedirect.findMany({
        where: { siteId, active: true, ...(p.id ? { NOT: { id: p.id } } : {}) },
        select: {
          sourcePath: true,
          sourceQuery: true,
          target: true,
          statusCode: true,
          active: true,
          id: true,
        },
      });
      issues.push(
        ...chainIssues(p, [
          ...active.map((r) => ({
            ...r,
            statusCode: (r.statusCode === 302 ? 302 : 301) as 301 | 302,
          })),
        ]),
      );
    }
    return issues;
  }

  async create(
    ctx: RequestContext,
    rawSiteId: string,
    body: unknown,
  ): Promise<SeoRedirectResponse> {
    const { a, siteId, db } = await this.begin(ctx, rawSiteId, "manage");
    const input = parseBody(SeoRedirectCreateRequestSchema, body);
    const addr = AdminRedirectsService.parseAddresses(input.source, input.target);
    const planned: Planned = {
      id: null,
      ...addr,
      statusCode: input.statusCode,
      active: input.active,
    };
    try {
      const { id, warnings } = await db.$transaction(async (tx) => {
        await lockSitePaths(tx, siteId);
        const live = await AdminRedirectsService.live(tx, siteId);
        const issues = await AdminRedirectsService.conflicts(tx, siteId, planned, live);
        if (issues.length) throw conflict(issues);
        const row = await tx.siteRedirect.create({
          data: {
            siteId,
            ...addr,
            statusCode: input.statusCode,
            active: input.active,
            origin: "MANUAL",
            note: input.note,
            createdById: a.userId,
            updatedById: a.userId,
          },
          select: { id: true },
        });
        await a.audit(tx, {
          action: "seo.redirect_created",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId,
          permission: MANAGE,
          metadata: { ...auditValues(planned, "MANUAL"), hasNote: input.note !== null },
        });
        return {
          id: row.id,
          warnings: await AdminRedirectsService.warningsFor(tx, siteId, planned, live),
        };
      }, TX);
      return { redirect: await this.one(a, db, siteId, id), warnings };
    } catch (e) {
      return mapDbError(e);
    }
  }

  private async one(a: StaffAccess, db: SiteScopedClient, siteId: string, id: string) {
    const row = await db.siteRedirect.findFirst({ where: { siteId, id }, select: ROW_SELECT });
    if (!row) throw new ApiError("NOT_FOUND");
    const [item] = await this.items(a, db, siteId, [row as Row]);
    return item!;
  }

  private static async rowIn(
    db: SiteScopedClient | ScopedTx,
    siteId: string,
    rawId: string,
  ): Promise<Row> {
    if (!UUID.test(rawId)) throw new ApiError("NOT_FOUND");
    const row = await (db as SiteScopedClient).siteRedirect.findFirst({
      where: { siteId, id: rawId.toLowerCase() },
      select: ROW_SELECT,
    });
    if (!row) throw new ApiError("NOT_FOUND");
    return row as Row;
  }

  async update(
    ctx: RequestContext,
    rawSiteId: string,
    rawId: string,
    body: unknown,
  ): Promise<SeoRedirectResponse> {
    const { a, siteId, db } = await this.begin(ctx, rawSiteId, "manage");
    const input = parseBody(SeoRedirectUpdateRequestSchema, body);
    await AdminRedirectsService.rowIn(db, siteId, rawId);
    const addr = AdminRedirectsService.parseAddresses(input.source, input.target);
    try {
      const { id, warnings } = await db.$transaction(async (tx) => {
        await lockSitePaths(tx, siteId);
        const row = await AdminRedirectsService.rowIn(tx, siteId, rawId);
        if (row.version !== input.version) throw conflict([{ path: "version", rule: "stale" }]);
        const planned: Planned = {
          id: row.id,
          ...addr,
          statusCode: input.statusCode,
          active: input.active,
        };
        const changed = {
          source: keyOf(row) !== keyOf(addr),
          target: row.target !== addr.target,
          statusCode: row.statusCode !== input.statusCode,
          active: row.active !== input.active,
          note: row.note !== input.note,
        };
        // DP-210 slug changes keep SEO integrity: only their note may change here.
        if (
          row.origin === "SLUG_CHANGE" &&
          (changed.source || changed.target || changed.statusCode || changed.active)
        ) {
          throw conflict([{ path: "redirect", rule: "protected" }]);
        }
        const live = await AdminRedirectsService.live(tx, siteId);
        if (row.origin !== "SLUG_CHANGE") {
          const issues = await AdminRedirectsService.conflicts(tx, siteId, planned, live);
          if (issues.length) throw conflict(issues);
        }
        if (!Object.values(changed).some(Boolean)) {
          return {
            id: row.id,
            warnings: await AdminRedirectsService.warningsFor(tx, siteId, planned, live),
          };
        }
        const updated = await tx.siteRedirect.updateMany({
          where: { id: row.id, siteId, version: row.version },
          data: {
            ...addr,
            statusCode: input.statusCode,
            active: input.active,
            note: input.note,
            updatedById: a.userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw conflict([{ path: "version", rule: "stale" }]);
        await a.audit(tx, {
          action: "seo.redirect_updated",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId,
          permission: MANAGE,
          metadata: {
            ...auditValues(planned, row.origin),
            previous: auditValues(
              { ...row, statusCode: row.statusCode === 302 ? 302 : 301 },
              row.origin,
            ),
            changed: Object.entries(changed)
              .filter(([, v]) => v)
              .map(([k]) => k),
          },
        });
        return {
          id: row.id,
          warnings:
            row.origin === "SLUG_CHANGE"
              ? []
              : await AdminRedirectsService.warningsFor(tx, siteId, planned, live),
        };
      }, TX);
      return { redirect: await this.one(a, db, siteId, id), warnings };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async remove(
    ctx: RequestContext,
    rawSiteId: string,
    rawId: string,
    body: unknown,
  ): Promise<{ deleted: true }> {
    const { a, siteId, db } = await this.begin(ctx, rawSiteId, "manage");
    const input = parseBody(SeoRedirectDeleteRequestSchema, body);
    await AdminRedirectsService.rowIn(db, siteId, rawId);
    try {
      await db.$transaction(async (tx) => {
        await lockSitePaths(tx, siteId);
        const row = await AdminRedirectsService.rowIn(tx, siteId, rawId);
        if (row.origin === "SLUG_CHANGE") throw conflict([{ path: "redirect", rule: "protected" }]);
        if (row.version !== input.version) throw conflict([{ path: "version", rule: "stale" }]);
        const gone = await tx.siteRedirect.deleteMany({
          where: { id: row.id, siteId, version: row.version },
        });
        if (gone.count !== 1) throw conflict([{ path: "version", rule: "stale" }]);
        await a.audit(tx, {
          action: "seo.redirect_deleted",
          resourceType: RESOURCE,
          resourceId: row.id,
          siteId,
          permission: MANAGE,
          metadata: {
            ...auditValues({ ...row, statusCode: row.statusCode === 302 ? 302 : 301 }, row.origin),
            version: row.version,
            hasNote: row.note !== null,
          },
        });
      }, TX);
      return { deleted: true };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async history(
    ctx: RequestContext,
    rawSiteId: string,
    rawId: string,
  ): Promise<SeoRedirectHistoryResponse> {
    const { a, siteId, db } = await this.begin(ctx, rawSiteId, "history");
    if (!UUID.test(rawId)) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    // A deleted redirect keeps its history: the row is not required, its events are.
    const events = await a.staffData((tx) =>
      tx.auditEvent.findMany({
        where: { siteId, resourceType: RESOURCE, resourceId: id, outcome: "SUCCESS" },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 200,
        select: { id: true, occurredAt: true, action: true, actorUserId: true, metadata: true },
      }),
    );
    if (events.length === 0) await AdminRedirectsService.rowIn(db, siteId, id);
    const names = await a.staffNames(events.flatMap((e) => (e.actorUserId ? [e.actorUserId] : [])));
    return {
      events: events.map((e) => {
        const details = { ...((e.metadata ?? {}) as Record<string, unknown>) };
        delete details["permission"];
        return {
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          action: e.action,
          actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
          details,
        };
      }),
    };
  }

  // --- CSV import ---------------------------------------------------------------------------------

  /**
   * The plan of an import: one result per CSV row against the site's current rows and live
   * content (`create`, `update`, `unchanged` or `error` with rules), checked as a whole for
   * chains. Pure reads; the import runs it again under the site lock.
   */
  private static async plan(db: SiteScopedClient | ScopedTx, siteId: string, csv: string) {
    const parsed = parseRedirectCsv(csv);
    if (!parsed.ok) {
      throw new ApiError("VALIDATION_FAILED", [
        { path: parsed.line ? `csv.${parsed.line}` : "csv", rule: parsed.rule },
      ]);
    }
    const d = db as SiteScopedClient;
    const [existing, live] = await Promise.all([
      d.siteRedirect.findMany({ where: { siteId }, select: ROW_SELECT }),
      AdminRedirectsService.live(db, siteId),
    ]);
    const byKey = new Map(existing.map((r) => [keyOf(r), r as Row]));
    const seen = new Set<string>();
    const rows: (SeoRedirectImportRow & { planned: Planned | null; existing: Row | null })[] = [];
    for (const r of parsed.rows) {
      const errors: string[] = [];
      const statusCode = parseCsvStatus(r.status);
      const active = parseCsvActive(r.active);
      if (statusCode === null) errors.push("status:format");
      if (active === null) errors.push("active:format");
      // eslint-disable-next-line no-control-regex -- matching control characters is the purpose
      if (r.note.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.note)) {
        errors.push("note:format");
      }
      const s = parseRedirectSource(r.source);
      const t = parseRedirectTarget(r.target);
      if (!s.ok) errors.push(`source:${s.rule}`);
      if (!t.ok) errors.push(`target:${t.rule}`);
      let planned: Planned | null = null;
      let current: Row | null = null;
      let action: SeoRedirectImportRow["action"] = "error";
      if (s.ok && t.ok) {
        if (s.value.sourceQuery === "" && redirectTargetPath(t.value) === s.value.sourcePath) {
          errors.push("target:self");
        }
        const key = keyOf(s.value);
        if (seen.has(key)) errors.push("source:duplicate_in_file");
        seen.add(key);
        if ((active ?? true) && live.has(s.value.sourcePath)) errors.push("source:live_content");
        current = byKey.get(key) ?? null;
        planned = {
          id: current?.id ?? null,
          ...s.value,
          target: t.value,
          statusCode: statusCode ?? 301,
          active: active ?? true,
        };
        const note = r.note === "" ? null : r.note;
        if (current) {
          const same =
            current.target === planned.target &&
            current.statusCode === planned.statusCode &&
            current.active === planned.active &&
            (current.origin === "SLUG_CHANGE" || current.note === note);
          if (same) action = "unchanged";
          else if (current.origin === "SLUG_CHANGE") errors.push("redirect:protected");
          else action = "update";
        } else action = "create";
      }
      rows.push({
        line: r.line,
        source: s.ok ? redirectSourceLabel(s.value) : r.source,
        target: t.ok ? t.value : r.target,
        statusCode,
        active,
        note: r.note === "" ? null : r.note,
        action: errors.length ? "error" : action,
        errors,
        warnings: [],
        planned,
        existing: current,
      });
    }
    // The site after the import: current active rows, replaced or joined by the planned ones.
    const plannedKeys = new Set(
      rows.filter((r) => r.planned && !r.errors.length).map((r) => keyOf(r.planned!)),
    );
    const after: Planned[] = [
      ...existing
        .filter((r) => r.active && !plannedKeys.has(keyOf(r)))
        .map((r) => ({ ...r, statusCode: (r.statusCode === 302 ? 302 : 301) as 301 | 302 })),
      ...rows
        .filter((r) => r.planned && !r.errors.length && r.planned.active)
        .map((r) => r.planned!),
    ];
    for (const r of rows) {
      if (!r.planned || r.errors.length) continue;
      for (const i of chainIssues(r.planned, after)) r.errors.push(`${i.path}:${i.rule}`);
      if (r.errors.length) {
        r.action = "error";
        continue;
      }
      if (r.action !== "unchanged") {
        r.warnings = await AdminRedirectsService.warningsFor(db, siteId, r.planned, live);
      }
    }
    const summary = { rows: rows.length, create: 0, update: 0, unchanged: 0, error: 0 };
    for (const r of rows) summary[r.action] += 1;
    const planHash = createHash("sha256")
      .update(
        JSON.stringify(
          rows.map((r) => [
            r.line,
            r.source,
            r.target,
            r.statusCode,
            r.active,
            r.note,
            r.action,
            r.errors,
            r.existing?.version ?? 0,
          ]),
        ),
      )
      .digest("hex");
    return { rows, summary, planHash };
  }

  async import(
    ctx: RequestContext,
    rawSiteId: string,
    body: unknown,
  ): Promise<SeoRedirectImportResponse> {
    const { a, siteId, db } = await this.begin(ctx, rawSiteId, "manage");
    const input = parseBody(SeoRedirectImportRequestSchema, body);
    const out = (p: Awaited<ReturnType<typeof AdminRedirectsService.plan>>, applied: boolean) => ({
      dryRun: input.dryRun,
      applied,
      planHash: p.planHash,
      summary: p.summary,
      rows: p.rows.map((r) => ({
        line: r.line,
        source: r.source,
        target: r.target,
        statusCode: r.statusCode,
        active: r.active,
        note: r.note,
        action: r.action,
        errors: r.errors,
        warnings: r.warnings,
      })),
    });
    if (input.dryRun) return out(await AdminRedirectsService.plan(db, siteId, input.csv), false);
    if (!input.planHash)
      throw new ApiError("VALIDATION_FAILED", [{ path: "planHash", rule: "required" }]);
    try {
      const result = await db.$transaction(async (tx) => {
        await lockSitePaths(tx, siteId);
        const p = await AdminRedirectsService.plan(tx, siteId, input.csv);
        if (p.summary.error > 0) throw conflict([{ path: "import", rule: "has_errors" }]);
        if (p.planHash !== input.planHash) throw conflict([{ path: "import", rule: "changed" }]);
        const audit = (action: string, id: string, planned: Planned, origin: string, extra = {}) =>
          a.audit(tx, {
            action,
            resourceType: RESOURCE,
            resourceId: id,
            siteId,
            permission: MANAGE,
            metadata: { ...auditValues(planned, origin), via: "import", ...extra },
          });
        const updates = p.rows.filter((r) => r.action === "update");
        // Order keeps every intermediate state chain-free: switch-offs, then the other updates of
        // active rows, then switch-ons, then new rows.
        const rank = (r: (typeof updates)[number]) =>
          !r.planned!.active ? 0 : r.existing!.active ? 1 : 2;
        for (const r of [...updates].sort((x, y) => rank(x) - rank(y))) {
          const done = await tx.siteRedirect.updateMany({
            where: { id: r.existing!.id, siteId, version: r.existing!.version },
            data: {
              target: r.planned!.target,
              statusCode: r.planned!.statusCode,
              active: r.planned!.active,
              note: r.note,
              updatedById: a.userId,
              version: { increment: 1 },
            },
          });
          if (done.count !== 1) throw conflict([{ path: "import", rule: "changed" }]);
          await audit("seo.redirect_updated", r.existing!.id, r.planned!, r.existing!.origin, {
            line: r.line,
            previous: auditValues(
              { ...r.existing!, statusCode: r.existing!.statusCode === 302 ? 302 : 301 },
              r.existing!.origin,
            ),
          });
        }
        for (const r of p.rows.filter((x) => x.action === "create")) {
          const row = await tx.siteRedirect.create({
            data: {
              siteId,
              sourcePath: r.planned!.sourcePath,
              sourceQuery: r.planned!.sourceQuery,
              target: r.planned!.target,
              statusCode: r.planned!.statusCode,
              active: r.planned!.active,
              origin: "IMPORT",
              note: r.note,
              createdById: a.userId,
              updatedById: a.userId,
            },
            select: { id: true },
          });
          await audit("seo.redirect_created", row.id, r.planned!, "IMPORT", { line: r.line });
        }
        await a.audit(tx, {
          action: "seo.redirects_imported",
          resourceType: RESOURCE,
          resourceId: null,
          siteId,
          permission: MANAGE,
          metadata: { ...p.summary, planHash: p.planHash },
        });
        return p;
      }, TX);
      return out(result, true);
    } catch (e) {
      return mapDbError(e);
    }
  }
}

function auditValues(p: Omit<Planned, "id">, origin: string) {
  return {
    sourcePath: p.sourcePath,
    sourceQuery: p.sourceQuery,
    target: p.target,
    statusCode: p.statusCode,
    active: p.active,
    origin,
  };
}
