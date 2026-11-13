import { handleLeadRequest } from "@/lib/lead-api";

/**
 * DP-042 (ADR-016): the short request form of a lead-gated document. Forwarded to the platform API
 * with this site's key; the download grant comes back as an HttpOnly cookie scoped to
 * `/product-documents/<id>`, never in the response body.
 */
export async function POST(request: Request, ctx: RouteContext<"/product-documents/[id]/request">) {
  const { id } = await ctx.params;
  return handleLeadRequest(request, id);
}
