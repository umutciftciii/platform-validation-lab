/**
 * Routes of technical specifications and product images (PM-2), under /api/v1/admin/catalog.
 * Only the admin proxy key reaches them. JSON changes use POST/DELETE (the methods the admin proxy
 * forwards); the image upload is the one PUT with a raw image body (security.middleware.ts).
 */
import {
  Body,
  Controller,
  Delete,
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
import { ImagesService, inlineDisposition } from "./images.service.js";
import { SpecsService } from "./specs.service.js";

@Controller("api/v1/admin/catalog")
export class SpecsImagesController {
  constructor(
    @Inject(SpecsService) private readonly specs: SpecsService,
    @Inject(ImagesService) private readonly images: ImagesService,
  ) {}

  // --- specification definitions --------------------------------------------------------

  @Get("spec-definitions")
  listDefinitions(@Ctx() ctx: RequestContext) {
    return this.specs.listDefinitions(ctx);
  }

  @Post("spec-definitions")
  @HttpCode(201)
  createDefinition(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.specs.createDefinition(ctx, body);
  }

  @Post("spec-definitions/:id")
  @HttpCode(200)
  updateDefinition(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.specs.updateDefinition(ctx, id, body);
  }

  @Delete("spec-definitions/:id")
  @HttpCode(204)
  async deleteDefinition(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<void> {
    await this.specs.deleteDefinition(ctx, id);
  }

  // --- product specification values -----------------------------------------------------

  @Get("products/:id/specs")
  getSpecs(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.specs.getProductSpecs(ctx, id);
  }

  @Post("products/:id/specs")
  @HttpCode(200)
  saveSpecs(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.specs.saveProductSpecs(ctx, id, body);
  }

  // --- images ---------------------------------------------------------------------------

  @Get("products/:id/images")
  listImages(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.images.list(ctx, id);
  }

  @Put("products/:id/images")
  @HttpCode(201)
  async upload(@Ctx() ctx: RequestContext, @Param("id") id: string, @Req() req: IncomingMessage) {
    try {
      return await this.images.upload(ctx, id, req);
    } catch (e) {
      // Refused before the body was read (auth, 404, limits): drain it so the socket is freed.
      if (!req.readableEnded) req.resume();
      throw e;
    }
  }

  @Post("products/:id/images/order")
  @HttpCode(200)
  reorder(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.images.reorder(ctx, id, body);
  }

  @Get("images/:imageId/:variant")
  async file(
    @Ctx() ctx: RequestContext,
    @Param("imageId") imageId: string,
    @Param("variant") variant: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const out = await this.images.file(ctx, imageId, variant);
    res.statusCode = 200;
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Length", String(out.data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", inlineDisposition(out.filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.end(out.data);
  }

  @Post("images/:imageId")
  @HttpCode(200)
  updateImage(@Ctx() ctx: RequestContext, @Param("imageId") id: string, @Body() body: unknown) {
    return this.images.update(ctx, id, body);
  }

  @Post("images/:imageId/cover")
  @HttpCode(200)
  setCover(@Ctx() ctx: RequestContext, @Param("imageId") id: string, @Body() body: unknown) {
    return this.images.setCover(ctx, id, body);
  }

  @Delete("images/:imageId")
  @HttpCode(204)
  async removeImage(@Ctx() ctx: RequestContext, @Param("imageId") id: string): Promise<void> {
    await this.images.remove(ctx, id);
  }
}
