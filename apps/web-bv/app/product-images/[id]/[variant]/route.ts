import { imageResponse } from "@/lib/catalog-api";

/**
 * Published product images (PM-3): the WebP display/thumb variants, proxied from the platform API
 * with this site's key. Only images shown by a live BV publication exist here; originals never do.
 */
export async function GET(_request: Request, ctx: RouteContext<"/product-images/[id]/[variant]">) {
  const { id, variant } = await ctx.params;
  return imageResponse(id, variant);
}
