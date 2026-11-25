/**
 * ML-13a (DP-244, ADR-028 D13): translation packages — export, read-only dry run, import as drafts
 * (contracts translation-packages.ts for the format, the statuses and the endpoints).
 *
 * Authorization (existing permissions, no new role or permission):
 *  - export: `content:read` of the site for "cms", `product:read` of the site for "catalog";
 *  - dry run: the same read permissions for the parts the package declares; the report says which
 *    edit permissions the caller lacks for the import;
 *  - import: `content:edit` of the site (CMS units), `product:edit` of the site (listing and
 *    category units), `product_master:edit` (platform; specification and image units). Every one
 *    of them or 403 before anything is read (owner decision 2026-11-25: refused as a whole).
 *
 * The package is refused as a whole (400) when it does not match the schema, when a unit's
 * `source`/`current` does not match its hash, or when it names another site key; 409 when the
 * site's default language is no longer the package's source language or the target language is
 * not enabled. Otherwise every unit is decided on its own (units.ts) and the valid ones are written
 * in ONE transaction with the audit events (per row, plus one summary event with the package
 * digest and the counts; never a text). A concurrent change of a row the import writes makes the
 * whole import stale (409); nothing is written then.
 *
 * DP-285: the dry run (read only) and the import each run in ONE bounded transaction
 * (IMPORT_LIMITS, DRY_RUN_LIMITS): the languages, the plan and every write see the same
 * transaction, lock waits and statements are limited by PostgreSQL, and a refusal is 409
 * `{transaction, locked}` or 503 DATABASE_UNAVAILABLE `{transaction, timeout|busy|connection}`
 * instead of a 500 after the lock is released. Every refusal but "connection" is a rollback
 * (nothing written, nothing published); after a lost answer the admin runs the dry run again,
 * which shows the units already imported as unchanged (re-importing writes nothing twice).
 *
 * Idempotency: importing the same package again changes no row and raises no version (content and
 * versions are compared before anything is written). The summary audit event is still written
 * for every import, by design (the attempt is accountable); per-row events only for changed rows.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  TRANSLATION_PACKAGE_FORMAT,
  TRANSLATION_PACKAGE_VERSION,
  TRANSLATION_UNIT_STATUSES,
  TranslationExportQuerySchema,
  TranslationImportRequestSchema,
  type TranslationImportReport,
  type TranslationPackage,
  type TranslationPackageType,
  type TranslationUnitStatus,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { transientDbError } from "../iam/bounded-transaction.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import type { CmsDb } from "../cms/cms-content.js";
import { mapCmsDbError } from "../cms/errors.js";
import { siteLocalesOf } from "../cms/site-locales.js";
import { keepsOldAddress } from "../seo/redirects.js";
import { applyCatalog, exportCatalog, planCatalog, type CatalogPlan } from "./catalog-part.js";
import { applyCms, exportCms, planCms, type CmsEnv, type CmsPlan } from "./cms-part.js";
import { DRY_RUN_LIMITS, IMPORT_LIMITS } from "./limits.js";
import { canonicalDigest, textHash } from "./units.js";

const RESOURCE = "translation_package";
const READ: Record<TranslationPackageType, string> = {
  cms: "content:read",
  catalog: "product:read",
};

type Edit = { permission: string; scope: "site" | "platform" };
const EDIT_OF = {
  cms: { permission: "content:edit", scope: "site" },
  listing: { permission: "product:edit", scope: "site" },
  category: { permission: "product:edit", scope: "site" },
  spec: { permission: "product_master:edit", scope: "platform" },
  image: { permission: "product_master:edit", scope: "platform" },
} as const satisfies Record<string, Edit>;

@Injectable()
export class TranslationPackagesService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** The site's languages: the default one, and `target` must be another enabled one. */
  private static env(a: StaffAccess, siteId: string, target: string): Promise<CmsEnv> {
    return TranslationPackagesService.envIn(
      a.db({ siteIds: [siteId], includePlatform: false }),
      a,
      siteId,
      target,
    );
  }

  /** `env` read through `db` (DP-285: the dry run's or the import's transaction). */
  private static async envIn(
    db: CmsDb,
    a: StaffAccess,
    siteId: string,
    target: string,
  ): Promise<CmsEnv> {
    const locales = (await siteLocalesOf(db, [siteId])).get(siteId) ?? [];
    const def = locales.find((l) => l.isDefault)?.locale;
    if (!def) throw new ApiError("INTERNAL_ERROR");
    if (target === def) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "locale", rule: "is_source" }]);
    }
    if (!locales.some((l) => l.locale === target && l.enabled)) {
      throw new ApiError("CONFLICT_STATE", [{ path: "locale", rule: "not_enabled" }]);
    }
    return {
      siteId,
      site: { locale: def, locales },
      defaultLocale: def,
      targetLocale: target,
      keepsOldAddress: keepsOldAddress(a.sites, siteId),
    };
  }

  private static async requireRead(
    a: StaffAccess,
    siteId: string,
    types: readonly TranslationPackageType[],
  ): Promise<void> {
    for (const t of types) {
      await a.require(READ[t], { scope: "site", siteId }, { type: RESOURCE, id: null });
    }
  }

  // --- export -----------------------------------------------------------------------------------

  async exportPackage(
    ctx: RequestContext,
    query: Record<string, unknown>,
  ): Promise<TranslationPackage> {
    const a = await this.access.begin(ctx);
    const input = parseBody(TranslationExportQuerySchema, query);
    const siteId = input.siteId.toLowerCase();
    await TranslationPackagesService.requireRead(a, siteId, input.types);
    const site = a.sites.find((s) => s.id === siteId);
    if (!site) throw new ApiError("NOT_FOUND");
    const env = await TranslationPackagesService.env(a, siteId, input.locale);
    const db = a.db({ siteIds: [siteId], includePlatform: true });
    const cms = input.types.includes("cms") ? await exportCms(db, env) : { pages: [], units: [] };
    const catalog = input.types.includes("catalog") ? await exportCatalog(db, env) : [];
    const pkg: TranslationPackage = {
      format: TRANSLATION_PACKAGE_FORMAT,
      version: TRANSLATION_PACKAGE_VERSION,
      site: { id: siteId, key: site.key as TranslationPackage["site"]["key"] },
      sourceLocale: env.defaultLocale,
      targetLocale: env.targetLocale,
      exportedAt: this.clock.now().toISOString(),
      types: input.types,
      pages: cms.pages,
      units: [...cms.units, ...catalog],
    };
    await a.audit(db, {
      action: "translation.package_exported",
      resourceType: RESOURCE,
      resourceId: null,
      siteId,
      permission: READ[input.types[0] ?? "cms"],
      metadata: {
        locale: env.targetLocale,
        types: input.types,
        pages: pkg.pages.length,
        units: pkg.units.length,
        digest: canonicalDigest(pkg),
      },
    });
    return pkg;
  }

  // --- dry run and import ----------------------------------------------------------------------

  dryRun(ctx: RequestContext, body: unknown): Promise<TranslationImportReport> {
    return this.run(ctx, body, true);
  }

  importPackage(ctx: RequestContext, body: unknown): Promise<TranslationImportReport> {
    return this.run(ctx, body, false);
  }

  private async run(
    ctx: RequestContext,
    body: unknown,
    dryRun: boolean,
  ): Promise<TranslationImportReport> {
    const a = await this.access.begin(ctx);
    const pkg = parseBody(TranslationImportRequestSchema, body).package;
    // A unit whose texts do not match their hashes was changed outside `target`: refused whole.
    const broken: { path: string; rule: string }[] = [];
    pkg.units.forEach((u, i) => {
      if (textHash(u.source) !== u.sourceHash) {
        broken.push({ path: `package.units.${i}.sourceHash`, rule: "mismatch" });
      }
      if (u.current !== null && textHash(u.current) !== u.currentHash) {
        broken.push({ path: `package.units.${i}.currentHash`, rule: "mismatch" });
      }
    });
    if (broken.length) throw new ApiError("VALIDATION_FAILED", broken.slice(0, 50));
    const siteId = pkg.site.id.toLowerCase();

    // Permissions first (403 refuses the whole package; unknown sites are refused too).
    const edits = new Map<string, Edit>();
    for (const u of pkg.units) edits.set(EDIT_OF[u.kind].permission, EDIT_OF[u.kind]);
    if (pkg.pages.length) edits.set(EDIT_OF.cms.permission, EDIT_OF.cms);
    const target = (e: Edit) =>
      e.scope === "site" ? ({ scope: "site", siteId } as const) : ({ scope: "platform" } as const);
    let missingPermissions: string[] = [];
    if (dryRun) {
      await TranslationPackagesService.requireRead(a, siteId, pkg.types);
      missingPermissions = [...edits.values()]
        .filter((e) => !a.allows(e.permission, target(e)))
        .map((e) => e.permission);
    } else {
      for (const e of edits.values()) {
        await a.require(e.permission, target(e), { type: RESOURCE, id: null });
      }
    }
    const site = a.sites.find((s) => s.id === siteId);
    if (!site) throw new ApiError("NOT_FOUND");
    if (site.key !== pkg.site.key) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "package.site.key", rule: "mismatch" }]);
    }
    const digest = canonicalDigest(pkg);
    const scope = { siteIds: [siteId], includePlatform: true };
    const prepare = async (d: CmsDb) => {
      const env = await TranslationPackagesService.envIn(d, a, siteId, pkg.targetLocale);
      if (env.defaultLocale !== pkg.sourceLocale) {
        throw new ApiError("CONFLICT_STATE", [{ path: "package.sourceLocale", rule: "changed" }]);
      }
      return { env, cms: await planCms(d, env, pkg), catalog: await planCatalog(d, env, pkg) };
    };

    try {
      if (dryRun) {
        return await a.boundedTx(scope, DRY_RUN_LIMITS, async (tx) => {
          const p = await prepare(tx);
          return report({ pkg, digest, dryRun, missingPermissions, ...p, written: EMPTY_WRITTEN });
        });
      }
      return await a.boundedTx(scope, IMPORT_LIMITS, async (tx) => {
        const p = await prepare(tx);
        const now = this.clock.now();
        const cms = await applyCms(tx, a, p.env, p.cms, { now, digest });
        const catalog = await applyCatalog(tx, a, p.env, p.catalog, { digest });
        const written = {
          cmsPagesCreated: cms.created,
          cmsPagesUpdated: cms.updated,
          ...catalog,
        };
        const out = report({ pkg, digest, dryRun, missingPermissions: [], ...p, written });
        await a.audit(tx, {
          action: "translation.package_imported",
          resourceType: RESOURCE,
          resourceId: null,
          siteId,
          permission: [...edits.keys()][0] ?? "content:edit",
          metadata: {
            digest,
            sourceLocale: pkg.sourceLocale,
            targetLocale: pkg.targetLocale,
            types: pkg.types,
            exportedAt: pkg.exportedAt,
            counts: out.counts,
            written,
          },
        });
        return out;
      });
    } catch (e) {
      const transient = transientDbError(e);
      if (transient) throw transient;
      return mapCmsDbError(e);
    }
  }
}

const EMPTY_WRITTEN = {
  cmsPagesCreated: 0,
  cmsPagesUpdated: 0,
  listings: 0,
  categories: 0,
  specs: 0,
  images: 0,
};

function report(input: {
  pkg: TranslationPackage;
  env: CmsEnv;
  digest: string;
  dryRun: boolean;
  missingPermissions: string[];
  cms: CmsPlan;
  catalog: CatalogPlan;
  written: TranslationImportReport["written"];
}): TranslationImportReport {
  const counts = Object.fromEntries(TRANSLATION_UNIT_STATUSES.map((s) => [s, 0])) as Record<
    TranslationUnitStatus,
    number
  >;
  const units = input.pkg.units.map((u) => {
    const d = input.cms.decisions.get(u.key) ??
      input.catalog.decisions.get(u.key) ?? { status: "not_found" as const, rule: null };
    counts[d.status] += 1;
    return { key: u.key, status: d.status, rule: d.rule };
  });
  return {
    dryRun: input.dryRun,
    digest: input.digest,
    siteId: input.env.siteId,
    sourceLocale: input.pkg.sourceLocale,
    targetLocale: input.pkg.targetLocale,
    canImport: input.missingPermissions.length === 0,
    missingPermissions: input.missingPermissions,
    counts,
    pages: input.cms.pages.map((p) => p.page),
    units,
    written: input.written,
  };
}
