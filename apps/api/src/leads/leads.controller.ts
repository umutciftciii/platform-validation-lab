/**
 * Lead routes (DP-042; ADR-016). Public: the site's server forwards the short form and the contact
 * form (DP-151; site from its proxy key). Admin: list and detail with lead:read; the sales workflow (status, assignment,
 * notes, contacts) with lead:manage (DP-041, ADR-019). Export: CSV of the filtered list with
 * lead:export and its step-up (DP-227, lead-export.service.ts).
 */
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { LEAD_EXPORT_SEPARATOR_PARAM } from "@dream/contracts";
import type {
  LeadActivityResponse,
  LeadContactMessageResponse,
  LeadDetailResponse,
  LeadDocumentRequestResponse,
  LeadExportSummaryResponse,
  LeadListResponse,
  LeadNotificationSaveResponse,
  LeadNotificationSettingsResponse,
  LeadWorkflowResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AdminLeadsService } from "./admin-leads.service.js";
import { ContactMessagesService } from "./contact-messages.service.js";
import { LeadExportService } from "./lead-export.service.js";
import type { LeadFilterQuery } from "./lead-filters.js";
import { LeadNotificationSettingsService } from "./lead-notification-settings.service.js";
import { LeadRequestsService } from "./lead-requests.service.js";

function single(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** DP-227: the list filters (without the cursor) from the query string. */
function filters(query: Record<string, unknown>): LeadFilterQuery {
  return {
    siteId: single(query["siteId"]),
    q: single(query["q"]),
    status: single(query["status"]),
    assignee: single(query["assignee"]),
    source: single(query["source"]),
    from: single(query["from"]),
    to: single(query["to"]),
  };
}

/** Resolves once the response can take more data; rejects when the client went away. */
async function writable(res: ServerResponse): Promise<void> {
  const ac = new AbortController();
  try {
    await Promise.race([
      once(res, "drain", { signal: ac.signal }),
      once(res, "close", { signal: ac.signal }).then(() => {
        throw new Error("client_closed");
      }),
    ]);
  } finally {
    ac.abort();
  }
}

@Controller("api/v1/public/leads")
export class PublicLeadsController {
  constructor(
    @Inject(LeadRequestsService) private readonly leads: LeadRequestsService,
    @Inject(ContactMessagesService) private readonly contact: ContactMessagesService,
  ) {}

  @Post("document-requests")
  @HttpCode(201)
  request(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<LeadDocumentRequestResponse> {
    return this.leads.request(ctx, body);
  }

  /** DP-151: a message from the site's contact form. */
  @Post("contact-messages")
  @HttpCode(201)
  contactMessage(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<LeadContactMessageResponse> {
    return this.contact.send(ctx, body);
  }
}

@Controller("api/v1/admin/leads")
export class AdminLeadsController {
  private readonly logger = new Logger("LeadExport");

  constructor(
    @Inject(AdminLeadsService) private readonly leads: AdminLeadsService,
    @Inject(LeadExportService) private readonly exports: LeadExportService,
  ) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<LeadListResponse> {
    return this.leads.list(ctx, { ...filters(query), cursor: single(query["cursor"]) });
  }

  /** DP-227: how many leads the filters match and whether the caller may export them. */
  @Get("export/summary")
  exportSummary(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<LeadExportSummaryResponse> {
    return this.exports.summary(ctx, filters(query));
  }

  /**
   * DP-227: the filtered leads as a CSV file (lead:export with step-up), cells separated by the
   * `separator` query value (DP-229: `;` by default, or `,`; anything else is a 400). Refusals answer the usual
   * JSON error before any byte of the file. The body streams batch by batch; a failure after the
   * first byte aborts the connection (the browser sees a failed download, never a cut file that
   * looks complete). Nothing of the content is logged.
   */
  @Get("export.csv")
  async exportCsv(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const file = await this.exports.open(ctx, filters(query), query[LEAD_EXPORT_SEPARATOR_PARAM]);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-DP-Export-Rows", String(file.count));
    try {
      for await (const chunk of file.chunks) {
        if (res.destroyed) break;
        if (!res.write(chunk)) await writable(res);
      }
      res.end();
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "client_closed" ? "client_closed" : "error";
      // The reason only: never a row, an address or a database message (it can quote values).
      this.logger.warn(`lead export aborted (${reason}, request ${ctx.requestId})`);
      await file.chunks.return(undefined);
      res.destroy();
    }
  }

  @Get(":id")
  detail(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<LeadDetailResponse> {
    return this.leads.detail(ctx, id);
  }

  /** DP-041: status and/or assignment (lead:manage, optimistic `version`). */
  @Post(":id/workflow")
  @HttpCode(200)
  workflow(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadWorkflowResponse> {
    return this.leads.workflow(ctx, id, body);
  }

  /** DP-041: a note or a contact record (lead:manage). */
  @Post(":id/activities")
  @HttpCode(201)
  addActivity(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadActivityResponse> {
    return this.leads.addActivity(ctx, id, body);
  }
}

/** DP-221 (ADR-026 D3): contact-form notification settings, per site (lead:manage). */
@Controller("api/v1/admin/lead-notifications")
export class AdminLeadNotificationsController {
  constructor(
    @Inject(LeadNotificationSettingsService)
    private readonly settings: LeadNotificationSettingsService,
  ) {}

  @Get()
  get(@Ctx() ctx: RequestContext): Promise<LeadNotificationSettingsResponse> {
    return this.settings.get(ctx);
  }

  @Post("sites/:siteId")
  @HttpCode(200)
  save(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<LeadNotificationSaveResponse> {
    return this.settings.save(ctx, siteId, body);
  }
}
