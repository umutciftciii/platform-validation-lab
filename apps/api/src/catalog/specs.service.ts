/**
 * Technical specifications (PM-2). Definitions and values are platform-wide master data:
 *  - reading needs `product:read` on at least one site (masters are shared by every site);
 *  - every change needs the PLATFORM permission `product_master:edit`;
 *  - a product's values are saved as one set that replaces the previous one and bumps the
 *    product master's version (the values are part of the master; a stale version is 409);
 *  - value-level BLOCKING problems (type, unit, range, bounds, precision) refuse the save;
 *    missing required values do not (drafts may be incomplete) but show up as BLOCKING in the
 *    validation report that gates review and publication (PM-3, workflow.service.ts);
 *  - PM-3: a save is a content change of the master (master.ts): it returns a master in review
 *    or approved to DRAFT and records the editor (separation of duties).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  checkSpecValue,
  SpecDefinitionCreateRequestSchema,
  SpecDefinitionUpdateRequestSchema,
  SpecValuesSaveRequestSchema,
  validateProductData,
  type DefinitionRule,
  type ProductSpecsResponse,
  type SpecDefinition,
  type SpecValueData,
  type ValueForCheck,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { changeMaster } from "./master.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MASTER = "product_master:edit";
export const READ = "product:read";
export const PLATFORM = { scope: "platform" } as const;

type Dec = { toString(): string } | null;
const num = (d: Dec): number | null => (d === null ? null : Number(d.toString()));

interface DefinitionRow {
  id: string;
  key: string;
  name: string;
  dataType: "NUMBER" | "TEXT" | "BOOLEAN" | "RANGE";
  units: string[];
  testMethods: string[];
  required: boolean;
  minValue: Dec;
  maxValue: Dec;
  decimals: number | null;
  maxLength: number | null;
  sortOrder: number;
  archived: boolean;
  version: number;
  updatedAt: Date;
}

interface ValueRow {
  definitionId: string;
  numberValue: Dec;
  rangeMin: Dec;
  rangeMax: Dec;
  textValue: string | null;
  booleanValue: boolean | null;
  unit: string | null;
  testMethod: string | null;
  updatedAt: Date;
}

export function toRule(d: DefinitionRow): DefinitionRule {
  return {
    id: d.id,
    key: d.key,
    name: d.name,
    dataType: d.dataType,
    units: d.units,
    testMethods: d.testMethods,
    required: d.required,
    minValue: num(d.minValue),
    maxValue: num(d.maxValue),
    decimals: d.decimals,
    maxLength: d.maxLength,
    archived: d.archived,
  };
}

function toDefinition(d: DefinitionRow, valueCount: number): SpecDefinition {
  return {
    ...toRule(d),
    units: [...d.units],
    testMethods: [...d.testMethods],
    sortOrder: d.sortOrder,
    version: d.version,
    valueCount,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function valueData(v: ValueRow): SpecValueData {
  if (v.numberValue !== null) return { type: "NUMBER", number: num(v.numberValue) as number };
  if (v.rangeMin !== null) {
    return { type: "RANGE", min: num(v.rangeMin) as number, max: num(v.rangeMax) as number };
  }
  if (v.textValue !== null) return { type: "TEXT", text: v.textValue };
  return { type: "BOOLEAN", boolean: v.booleanValue as boolean };
}

function columnsOf(value: SpecValueData) {
  return {
    numberValue: value.type === "NUMBER" ? value.number : null,
    rangeMin: value.type === "RANGE" ? value.min : null,
    rangeMax: value.type === "RANGE" ? value.max : null,
    textValue: value.type === "TEXT" ? value.text : null,
    booleanValue: value.type === "BOOLEAN" ? value.boolean : null,
  };
}

/** Reading master data: product:read on any site (masters are shared by every site). */
export async function requireMasterRead(
  a: StaffAccess,
  resource: { type: string; id: string | null },
): Promise<void> {
  if (a.sitesWith(READ).length > 0) return;
  await a.require(READ, PLATFORM, resource); // audits the refusal and throws 403
}

export function uuidOr404(id: string): string {
  if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
  return id.toLowerCase();
}

@Injectable()
export class SpecsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  private static db(a: StaffAccess) {
    return a.db({ siteIds: [], includePlatform: true });
  }

  private static async valueCounts(
    db: ReturnType<StaffAccess["db"]>,
  ): Promise<Map<string, number>> {
    const groups = await db.productSpecValue.groupBy({
      by: ["definitionId"],
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.definitionId, g._count._all]));
  }

  // --- definitions ---------------------------------------------------------------------------

  async listDefinitions(ctx: RequestContext): Promise<{ items: SpecDefinition[] }> {
    const a = await this.access.begin(ctx);
    await requireMasterRead(a, { type: "spec_definition", id: null });
    const db = SpecsService.db(a);
    const [rows, counts] = await Promise.all([
      db.specDefinition.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      SpecsService.valueCounts(db),
    ]);
    return { items: rows.map((d) => toDefinition(d, counts.get(d.id) ?? 0)) };
  }

  async createDefinition(
    ctx: RequestContext,
    body: unknown,
  ): Promise<{ definition: SpecDefinition }> {
    const a = await this.access.begin(ctx);
    await a.require(MASTER, PLATFORM, { type: "spec_definition", id: null });
    const input = parseBody(SpecDefinitionCreateRequestSchema, body);
    const db = SpecsService.db(a);
    try {
      const row = await db.$transaction(async (tx) => {
        const created = await tx.specDefinition.create({ data: input });
        await a.audit(tx, {
          action: "catalog.spec_definition_created",
          resourceType: "spec_definition",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: { key: created.key, dataType: created.dataType },
        });
        return created;
      });
      return { definition: toDefinition(row, 0) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async updateDefinition(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ definition: SpecDefinition }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "spec_definition", id });
    const { version, ...input } = parseBody(SpecDefinitionUpdateRequestSchema, body);
    const db = SpecsService.db(a);
    try {
      const row = await db.$transaction(async (tx) => {
        const before = await tx.specDefinition.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.dataType !== input.dataType) {
          throw new ApiError("CONFLICT_STATE", [{ path: "dataType", rule: "immutable" }]);
        }
        const res = await tx.specDefinition.updateMany({
          where: { id, version },
          data: { ...input, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const after = await tx.specDefinition.findUniqueOrThrow({ where: { id } });
        const changed = Object.keys(input).filter(
          (k) =>
            JSON.stringify((before as Record<string, unknown>)[k]?.toString?.() ?? null) !==
            JSON.stringify((after as Record<string, unknown>)[k]?.toString?.() ?? null),
        );
        await a.audit(tx, {
          action: "catalog.spec_definition_updated",
          resourceType: "spec_definition",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { key: after.key, changed, version: after.version },
        });
        return after;
      });
      const counts = await SpecsService.valueCounts(db);
      return { definition: toDefinition(row, counts.get(id) ?? 0) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async deleteDefinition(ctx: RequestContext, rawId: string): Promise<void> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "spec_definition", id });
    const db = SpecsService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const row = await tx.specDefinition.findUnique({ where: { id }, select: { key: true } });
        if (!row) throw new ApiError("NOT_FOUND");
        if ((await tx.productSpecValue.count({ where: { definitionId: id } })) > 0) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "in_use" }]);
        }
        await tx.specDefinition.deleteMany({ where: { id } });
        await a.audit(tx, {
          action: "catalog.spec_definition_deleted",
          resourceType: "spec_definition",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { key: row.key },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
  }

  // --- product values ------------------------------------------------------------------------

  private static async productSpecs(
    db: ReturnType<StaffAccess["db"]>,
    productId: string,
  ): Promise<ProductSpecsResponse> {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { version: true },
    });
    if (!product) throw new ApiError("NOT_FOUND");
    const [defs, values, images, counts] = await Promise.all([
      db.specDefinition.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      db.productSpecValue.findMany({ where: { productId } }),
      db.productImage.findMany({ where: { productId }, select: { id: true, altText: true } }),
      SpecsService.valueCounts(db),
    ]);
    const used = new Set(values.map((v) => v.definitionId));
    const shown = defs.filter((d) => !d.archived || used.has(d.id));
    const checks: ValueForCheck[] = values.map((v) => ({
      definitionId: v.definitionId,
      value: valueData(v),
      unit: v.unit,
      testMethod: v.testMethod,
    }));
    return {
      productVersion: product.version,
      definitions: shown.map((d) => toDefinition(d, counts.get(d.id) ?? 0)),
      values: values.map((v) => ({
        definitionId: v.definitionId,
        value: valueData(v),
        unit: v.unit,
        testMethod: v.testMethod,
        updatedAt: v.updatedAt.toISOString(),
      })),
      validation: validateProductData({ definitions: defs.map(toRule), values: checks, images }),
    };
  }

  async getProductSpecs(ctx: RequestContext, rawId: string): Promise<ProductSpecsResponse> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await requireMasterRead(a, { type: "product", id });
    return SpecsService.productSpecs(SpecsService.db(a), id);
  }

  async saveProductSpecs(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<ProductSpecsResponse> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product", id: productId });
    const input = parseBody(SpecValuesSaveRequestSchema, body);
    const db = SpecsService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { status: true },
        });
        if (!product) throw new ApiError("NOT_FOUND");
        if (product.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
        }
        const defs = await tx.specDefinition.findMany();
        const byId = new Map(defs.map((d) => [d.id, d]));
        const existing = await tx.productSpecValue.findMany({ where: { productId } });
        const had = new Map(existing.map((v) => [v.definitionId, v]));
        const seen = new Set<string>();
        const details: { path: string; rule: string }[] = [];
        for (const v of input.values) {
          const def = byId.get(v.definitionId);
          if (!def) {
            details.push({ path: `spec:${v.definitionId}`, rule: "unknown_definition" });
            continue;
          }
          if (seen.has(v.definitionId))
            details.push({ path: `spec:${def.key}`, rule: "duplicate" });
          seen.add(v.definitionId);
          if (def.archived && !had.has(def.id)) {
            details.push({ path: `spec:${def.key}`, rule: "archived" });
          }
          for (const i of checkSpecValue(toRule(def), v)) {
            if (i.severity === "BLOCKING") details.push({ path: i.target, rule: i.code });
          }
        }
        if (details.length) throw new ApiError("VALIDATION_FAILED", details.slice(0, 50));

        // PM-3: bumps the version, records the editor and resets a review or approval.
        await changeMaster(tx, a, productId, {
          expectedVersion: input.version,
          cause: "spec_values",
        });
        const removed = existing.filter((v) => !seen.has(v.definitionId));
        if (removed.length) {
          await tx.productSpecValue.deleteMany({
            where: { productId, definitionId: { in: removed.map((v) => v.definitionId) } },
          });
        }
        const changed: string[] = [];
        for (const v of input.values) {
          const cols = { ...columnsOf(v.value), unit: v.unit, testMethod: v.testMethod };
          const prev = had.get(v.definitionId);
          const same =
            prev &&
            JSON.stringify({ ...valueData(prev), u: prev.unit, t: prev.testMethod }) ===
              JSON.stringify({ ...v.value, u: v.unit, t: v.testMethod });
          if (same) continue;
          changed.push((byId.get(v.definitionId) as DefinitionRow).key);
          await tx.productSpecValue.upsert({
            where: { productId_definitionId: { productId, definitionId: v.definitionId } },
            create: { productId, definitionId: v.definitionId, ...cols },
            update: cols,
          });
        }
        await a.audit(tx, {
          action: "catalog.spec_values_saved",
          resourceType: "product",
          resourceId: productId,
          siteId: null,
          permission: MASTER,
          metadata: {
            changed,
            removed: removed.map((v) => byId.get(v.definitionId)?.key ?? v.definitionId),
            version: input.version + 1,
          },
        });
      });
      return SpecsService.productSpecs(db, productId);
    } catch (e) {
      return mapDbError(e);
    }
  }
}
