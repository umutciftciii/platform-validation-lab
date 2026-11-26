/**
 * DP-298 (ADR-031 D1): the admin "Legal texts" screen (`/api/v1/admin/legal-texts`) and the
 * public snapshot the sites read (`/api/v1/public/legal-texts`).
 *
 * - `legal_text:edit` (platform): create, edit and delete drafts. `legal_text:publish`
 *   (platform, sensitive: fresh step-up): publish a draft and record the legal review. Reading
 *   needs either. Publication is not a super admin default (like every publication, F1-001B).
 * - Publishing names the version (`<date>.<locale>`, `<date>.<n>.<locale>` for another one on the
 *   same UTC day) and freezes it (database trigger). The publisher confirms the SHA-256 of the
 *   text they read; a draft edited meanwhile is refused (`stale`).
 * - Editing a draft resets its legal review to REQUIRED: an approval is for exact words.
 * - Every change is audited with ids, versions and hashes only (never the text).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  LegalDocumentKeySchema,
  LegalTextDraftCreateRequestSchema,
  LegalTextDraftUpdateRequestSchema,
  LegalTextPublishRequestSchema,
  LegalTextReviewRequestSchema,
  UuidSchema,
  policyEvidenceText,
  policyFromMarkup,
  type LegalDocumentKey,
  type LegalTextHistoryResponse,
  type LegalTextVersionDetail,
  type LegalTextVersionResponse,
  type LegalTextVersionSummary,
  type LegalTextsOverview,
  type PrivacySection,
  type PublicLegalTextsResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService } from "../iam/public-site.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { Clock } from "../iam/http/clock.js";
import { loadPublishedTexts, sha256Hex, type PublishedTexts } from "./published-texts.js";

const EDIT = "legal_text:edit";
const PUBLISH = "legal_text:publish";
const PLATFORM = { scope: "platform" } as const;

const SELECT = {
  id: true,
  key: true,
  locale: true,
  version: true,
  status: true,
  legalReview: true,
  reviewNote: true,
  text: true,
  sha256: true,
  translatesId: true,
  revision: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  publishedById: true,
  reviewApprovedAt: true,
  reviewApprovedById: true,
  translates: { select: { version: true } },
} as const;

interface Row {
  id: string;
  key: LegalDocumentKey;
  locale: string;
  version: string | null;
  status: "DRAFT" | "PUBLISHED";
  legalReview: "REQUIRED" | "APPROVED";
  reviewNote: string | null;
  text: string;
  sha256: string;
  translatesId: string | null;
  revision: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  publishedById: string | null;
  reviewApprovedAt: Date | null;
  reviewApprovedById: string | null;
  translates: { version: string | null } | null;
}

/** Minimal client shape (staff transaction) used here. */
type Tx = {
  legalTextVersion: {
    findMany(args: unknown): Promise<Row[]>;
    findUnique(args: unknown): Promise<Row | null>;
    findFirst(args: unknown): Promise<Row | null>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<Row>;
    update(args: unknown): Promise<Row>;
    delete(args: unknown): Promise<unknown>;
  };
  siteLocale: { findMany(args: unknown): Promise<{ locale: string }[]> };
};

const conflict = (rule: string, path = "version") =>
  new ApiError("CONFLICT_STATE", [{ path, rule }]);
const invalid = (path: string, rule: string) => new ApiError("VALIDATION_FAILED", [{ path, rule }]);

const GUARD = /legal texts: |LegalTextVersion_|insufficient_privilege|23505|23514|P2002/;
function isGuardRefusal(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && GUARD.test(msg)) return true;
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && GUARD.test(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** The stored form of a text: plain text, or the policy's markup with its sections. */
export function evidenceOf(
  key: LegalDocumentKey,
  raw: string,
): { text: string; sections: PrivacySection[] | null; sha256: string } {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) throw invalid("text", "required");
  if (text.length > LEGAL_DOCUMENTS[key].maxChars) throw invalid("text", "too_long");
  if (key !== "PRIVACY_POLICY") return { text, sections: null, sha256: sha256Hex(text) };
  const parsed = policyFromMarkup(text);
  if (!parsed.ok) throw invalid("text", `${parsed.rule}:${parsed.line}`);
  return {
    text,
    sections: parsed.sections,
    sha256: sha256Hex(policyEvidenceText(parsed.sections)),
  };
}

/** `<date>.<locale>` for the first version of a UTC day, `<date>.<n>.<locale>` for later ones. */
export function versionName(day: string, locale: string, existingThatDay: number): string {
  return existingThatDay === 0 ? `${day}.${locale}` : `${day}.${existingThatDay + 1}.${locale}`;
}

@Injectable()
export class LegalTextsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // --- public ----------------------------------------------------------------------------------

  /** For the lead services: the published texts, read through the form's own client. */
  published(db: unknown): Promise<PublishedTexts> {
    return loadPublishedTexts(db);
  }

  /** GET /api/v1/public/legal-texts (proxy key): the offered languages and the review gate. */
  async publicSnapshot(ctx: RequestContext): Promise<PublicLegalTextsResponse> {
    // Platform-wide texts: a site's proxy key, no Site row needed (fail closed for the admin key).
    const t = await loadPublishedTexts(this.sites.platform(ctx));
    return { sets: t.sets, pendingReview: t.pendingReview };
  }

  // --- admin -----------------------------------------------------------------------------------

  private async begin(
    ctx: RequestContext,
    need: "read" | "edit" | "publish",
  ): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const target = { type: "legal_text", id: null };
    if (need === "read") {
      if (access.allows(EDIT, PLATFORM) || access.allows(PUBLISH, PLATFORM)) return access;
      await access.require(EDIT, PLATFORM, target);
      return access;
    }
    await access.require(need === "edit" ? EDIT : PUBLISH, PLATFORM, target);
    return access;
  }

  private async names(access: StaffAccess, rows: Row[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) {
      for (const id of [r.createdById, r.publishedById, r.reviewApprovedById]) if (id) ids.add(id);
    }
    return access.staffNames([...ids]);
  }

  private summary(r: Row, names: Map<string, string>): LegalTextVersionSummary {
    const person = (id: string | null) =>
      id ? { id, displayName: names.get(id) ?? "Former staff member" } : null;
    return {
      id: r.id,
      key: r.key,
      locale: r.locale,
      version: r.version,
      status: r.status,
      legalReview: r.legalReview,
      reviewNote: r.reviewNote,
      translatesVersion: r.translates?.version ?? null,
      sha256: r.sha256,
      createdAt: r.createdAt.toISOString(),
      createdBy: person(r.createdById),
      updatedAt: r.updatedAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      publishedBy: person(r.publishedById),
      reviewApprovedAt: r.reviewApprovedAt?.toISOString() ?? null,
      reviewApprovedBy: person(r.reviewApprovedById),
      revision: r.revision,
    };
  }

  private detail(r: Row, names: Map<string, string>): LegalTextVersionDetail {
    return { ...this.summary(r, names), text: r.text };
  }

  async overview(ctx: RequestContext): Promise<LegalTextsOverview> {
    const access = await this.begin(ctx, "read");
    const { rows, locales, published } = await access.staffData(async (raw) => {
      const tx = raw as unknown as Tx;
      const rows = await tx.legalTextVersion.findMany({
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        select: SELECT,
      });
      const siteLocales = await tx.siteLocale.findMany({ select: { locale: true } });
      return {
        rows,
        locales: siteLocales.map((l) => l.locale),
        published: await loadPublishedTexts(raw),
      };
    });
    const names = await this.names(access, rows);
    const allLocales = [...new Set(["en", ...locales, ...rows.map((r) => r.locale)])].sort();
    return {
      documents: LEGAL_DOCUMENT_KEYS.map((key) => ({
        key,
        locales: allLocales.map((locale) => {
          const cur = published.current.get(`${key}|${locale}`);
          const curRow = cur ? rows.find((r) => r.id === cur.id) : undefined;
          const draft = rows.find(
            (r) => r.key === key && r.locale === locale && r.status === "DRAFT",
          );
          return {
            locale,
            current: curRow ? this.summary(curRow, names) : null,
            draft: draft ? this.summary(draft, names) : null,
          };
        }),
      })),
      locales: allLocales,
      blockers: published.blockers,
      permissions: {
        edit: access.allows(EDIT, PLATFORM),
        publish: access.allows(PUBLISH, PLATFORM),
      },
    };
  }

  async history(
    ctx: RequestContext,
    rawKey: string,
    locale: string,
  ): Promise<LegalTextHistoryResponse> {
    const access = await this.begin(ctx, "read");
    const key = LegalDocumentKeySchema.safeParse(rawKey);
    if (!key.success || !/^[a-z]{2}$/.test(locale)) throw new ApiError("NOT_FOUND");
    const rows = await access.staffData((raw) =>
      (raw as unknown as Tx).legalTextVersion.findMany({
        where: { key: key.data, locale },
        orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
        take: 500,
        select: SELECT,
      }),
    );
    const names = await this.names(access, rows);
    return { versions: rows.map((r) => this.summary(r, names)) };
  }

  async get(ctx: RequestContext, rawId: string): Promise<LegalTextVersionResponse> {
    const access = await this.begin(ctx, "read");
    const row = await this.find(access, rawId);
    return { version: this.detail(row, await this.names(access, [row])) };
  }

  private async find(access: StaffAccess, rawId: string): Promise<Row> {
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const row = await access.staffData((raw) =>
      (raw as unknown as Tx).legalTextVersion.findUnique({
        where: { id: rawId.toLowerCase() },
        select: SELECT,
      }),
    );
    if (!row) throw new ApiError("NOT_FOUND");
    return row;
  }

  private async mutate<T>(
    access: StaffAccess,
    fn: (tx: Tx, raw: unknown) => Promise<T>,
  ): Promise<T> {
    try {
      return await access.staffData((raw) => fn(raw as unknown as Tx, raw));
    } catch (error) {
      if (error instanceof ApiError || !isGuardRefusal(error)) throw error;
      throw conflict("db_guard");
    }
  }

  private auditEvent(
    access: StaffAccess,
    tx: unknown,
    action: string,
    row: Row,
    permission: string,
    extra: Record<string, unknown> = {},
  ) {
    return access.audit(tx, {
      action,
      resourceType: "legal_text",
      resourceId: row.id,
      siteId: null,
      permission,
      metadata: {
        key: row.key,
        locale: row.locale,
        version: row.version,
        sha256: row.sha256,
        ...extra,
      },
    });
  }

  async createDraft(ctx: RequestContext, body: unknown): Promise<LegalTextVersionResponse> {
    const access = await this.begin(ctx, "edit");
    const input = parseBody(LegalTextDraftCreateRequestSchema, body);
    const ev = evidenceOf(input.key, input.text);
    const row = await this.mutate(access, async (tx, raw) => {
      if (
        await tx.legalTextVersion.count({
          where: { key: input.key, locale: input.locale, status: "DRAFT" },
        })
      ) {
        throw conflict("draft_exists", "key");
      }
      if (input.translatesId) {
        const src = await tx.legalTextVersion.findUnique({
          where: { id: input.translatesId.toLowerCase() },
          select: SELECT,
        });
        if (
          !src ||
          src.status !== "PUBLISHED" ||
          src.key !== input.key ||
          src.locale === input.locale
        ) {
          throw invalid("translatesId", "published_source_of_same_document");
        }
      }
      const created = await tx.legalTextVersion.create({
        data: {
          key: input.key,
          locale: input.locale,
          text: ev.text,
          sections: ev.sections ?? undefined,
          sha256: ev.sha256,
          reviewNote: input.reviewNote,
          translatesId: input.translatesId?.toLowerCase() ?? null,
          createdById: access.userId,
        },
        select: SELECT,
      });
      await this.auditEvent(access, raw, "legal_text.draft_created", created, EDIT);
      return created;
    });
    return { version: this.detail(row, await this.names(access, [row])) };
  }

  async updateDraft(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<LegalTextVersionResponse> {
    const access = await this.begin(ctx, "edit");
    const input = parseBody(LegalTextDraftUpdateRequestSchema, body);
    const existing = await this.find(access, rawId);
    if (existing.status !== "DRAFT") throw conflict("published");
    const ev = evidenceOf(existing.key, input.text);
    const row = await this.mutate(access, async (tx, raw) => {
      const cur = await tx.legalTextVersion.findUnique({
        where: { id: existing.id },
        select: SELECT,
      });
      if (!cur || cur.status !== "DRAFT") throw conflict("published");
      if (cur.revision !== input.revision) throw conflict("stale", "revision");
      const updated = await tx.legalTextVersion.update({
        where: { id: existing.id },
        data: {
          text: ev.text,
          sections: ev.sections ?? undefined,
          sha256: ev.sha256,
          reviewNote: input.reviewNote,
          revision: cur.revision + 1,
          updatedAt: this.clock.now(),
          // An approval is for exact words: a changed text needs its review again.
          ...(ev.sha256 !== cur.sha256
            ? { legalReview: "REQUIRED", reviewApprovedAt: null, reviewApprovedById: null }
            : {}),
        },
        select: SELECT,
      });
      await this.auditEvent(access, raw, "legal_text.draft_updated", updated, EDIT, {
        textChanged: ev.sha256 !== cur.sha256,
      });
      return updated;
    });
    return { version: this.detail(row, await this.names(access, [row])) };
  }

  async deleteDraft(ctx: RequestContext, rawId: string): Promise<void> {
    const access = await this.begin(ctx, "edit");
    const existing = await this.find(access, rawId);
    if (existing.status !== "DRAFT") throw conflict("published");
    await this.mutate(access, async (tx, raw) => {
      await tx.legalTextVersion.delete({ where: { id: existing.id } });
      await this.auditEvent(access, raw, "legal_text.draft_deleted", existing, EDIT);
    });
  }

  async publish(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<LegalTextVersionResponse> {
    const access = await this.begin(ctx, "publish");
    const input = parseBody(LegalTextPublishRequestSchema, body);
    const existing = await this.find(access, rawId);
    if (existing.status !== "DRAFT") throw conflict("published");
    const now = this.clock.now();
    const day = now.toISOString().slice(0, 10);
    const row = await this.mutate(access, async (tx, raw) => {
      const cur = await tx.legalTextVersion.findUnique({
        where: { id: existing.id },
        select: SELECT,
      });
      if (!cur || cur.status !== "DRAFT") throw conflict("published");
      if (cur.sha256 !== input.sha256) throw conflict("stale", "sha256");
      const sameDay = await tx.legalTextVersion.count({
        where: {
          key: cur.key,
          locale: cur.locale,
          status: "PUBLISHED",
          version: { startsWith: `${day}.` },
        },
      });
      const published = await tx.legalTextVersion.update({
        where: { id: cur.id },
        data: {
          status: "PUBLISHED",
          version: versionName(day, cur.locale, sameDay),
          publishedAt: now,
          publishedById: access.userId,
          updatedAt: now,
        },
        select: SELECT,
      });
      await this.auditEvent(access, raw, "legal_text.published", published, PUBLISH, {
        legalReview: published.legalReview,
      });
      return published;
    });
    return { version: this.detail(row, await this.names(access, [row])) };
  }

  async approveReview(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<LegalTextVersionResponse> {
    const access = await this.begin(ctx, "publish");
    const input = parseBody(LegalTextReviewRequestSchema, body);
    const existing = await this.find(access, rawId);
    if (existing.legalReview === "APPROVED") throw conflict("already_approved", "legalReview");
    const now = this.clock.now();
    const row = await this.mutate(access, async (tx, raw) => {
      const cur = await tx.legalTextVersion.findUnique({
        where: { id: existing.id },
        select: SELECT,
      });
      if (!cur) throw new ApiError("NOT_FOUND");
      if (cur.sha256 !== input.sha256) throw conflict("stale", "sha256");
      if (cur.legalReview === "APPROVED") throw conflict("already_approved", "legalReview");
      const updated = await tx.legalTextVersion.update({
        where: { id: cur.id },
        data: {
          legalReview: "APPROVED",
          reviewApprovedAt: now,
          reviewApprovedById: access.userId,
          updatedAt: now,
        },
        select: SELECT,
      });
      await this.auditEvent(access, raw, "legal_text.review_approved", updated, PUBLISH);
      return updated;
    });
    return { version: this.detail(row, await this.names(access, [row])) };
  }
}
