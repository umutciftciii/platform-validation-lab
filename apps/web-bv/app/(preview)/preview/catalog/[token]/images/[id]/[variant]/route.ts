import { previewImageResponse } from "@/lib/catalog-preview-api";

/** DP-173: public image variants of listed products for the preview; never cached or indexed. */
export async function GET(_request: Request, ctx: RouteContext<"/preview/catalog/[token]/images/[id]/[variant]">) {
  const { token, id, variant } = await ctx.params;
  return previewImageResponse(token, id, variant);
}
