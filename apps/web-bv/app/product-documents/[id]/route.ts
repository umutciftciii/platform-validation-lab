import { documentResponse } from "@/lib/catalog-api";
import { grantHeaders } from "@/lib/lead-api";

/**
 * Technical documents of published BV products (PM-5): the pinned revision of a PUBLIC document
 * the BV publisher shows, proxied from the platform API with this site's key. DP-043: a
 * lead-gated document is served only with the grant cookie set by the request form (stamped for
 * its recipient). Members-only and internal documents are never served here (ADR-014, ADR-016).
 */
export async function GET(request: Request, ctx: RouteContext<"/product-documents/[id]">) {
  const { id } = await ctx.params;
  return documentResponse(id, undefined, grantHeaders(request, id));
}
