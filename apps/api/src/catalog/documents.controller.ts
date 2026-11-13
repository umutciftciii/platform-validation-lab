/**
 * Routes of technical documents (PM-5, DP-035), under /api/v1/admin/catalog. Only the admin proxy
 * key reaches them. JSON changes use POST (the methods the admin proxy forwards); the revision
 * upload is a PUT with a raw PDF body (security.middleware.ts). Files are served with a fixed
 * Content-Type, `nosniff` and no caching; `inline` previews in the browser's viewer.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { documentDisposition, DocumentsService } from "./documents.service.js";

@Controller("api/v1/admin/catalog")
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get("products/:id/documents")
  list(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.documents.list(ctx, id);
  }

  @Post("products/:id/documents")
  @HttpCode(201)
  create(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.create(ctx, id, body);
  }

  @Post("documents/:id")
  @HttpCode(200)
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.update(ctx, id, body);
  }

  @Put("documents/:id/revisions")
  @HttpCode(201)
  async upload(@Ctx() ctx: RequestContext, @Param("id") id: string, @Req() req: IncomingMessage) {
    try {
      return await this.documents.upload(ctx, id, req);
    } catch (e) {
      // Refused before the body was read (auth, 404, limits): drain it so the socket is freed.
      if (!req.readableEnded) req.resume();
      throw e;
    }
  }

  @Post("documents/:id/archive")
  @HttpCode(200)
  archive(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.setArchived(ctx, id, body, true);
  }

  @Post("documents/:id/restore")
  @HttpCode(200)
  restore(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.documents.setArchived(ctx, id, body, false);
  }

  @Post("documents/:id/sites/:siteId")
  @HttpCode(200)
  setSite(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.documents.setSite(ctx, id, siteId, body);
  }

  @Post("document-revisions/:revisionId/activate")
  @HttpCode(200)
  activate(
    @Ctx() ctx: RequestContext,
    @Param("revisionId") revisionId: string,
    @Body() body: unknown,
  ) {
    return this.documents.activate(ctx, revisionId, body);
  }

  @Get("document-revisions/:revisionId/:disposition")
  async file(
    @Ctx() ctx: RequestContext,
    @Param("revisionId") revisionId: string,
    @Param("disposition") disposition: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const out = await this.documents.file(ctx, revisionId, disposition);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(out.data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", documentDisposition(out.disposition, out.filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.end(out.data);
  }
}
