// PM-2: same-origin image upload of the admin app. Streams one raw image (≤ 10 MB) to the API;
// the contract and its limits live in lib/upload-proxy.ts. Every other call uses /api/v1/*.
import { errorBody } from "@dream/contracts";
import { randomUUID } from "node:crypto";
import { loadProxyConfig, type ProxyConfig } from "../../../../lib/api-proxy";
import { proxyImageUpload } from "../../../../lib/upload-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let config: ProxyConfig | undefined;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
): Promise<Response> {
  try {
    config ??= loadProxyConfig(process.env);
  } catch (error) {
    console.error(`upload proxy: ${(error as Error).message}`);
    return Response.json(errorBody("BAD_GATEWAY", randomUUID()), {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const { productId } = await params;
  return proxyImageUpload(request, productId, config, {
    fetch: globalThis.fetch,
    log: (line) => console.error(line),
  });
}
