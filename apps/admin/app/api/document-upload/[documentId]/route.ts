// PM-5: same-origin PDF upload of the admin app. Streams one raw PDF (≤ 20 MB) to the API as a
// new document revision; the contract and its limits live in lib/upload-proxy.ts.
import { errorBody } from "@dream/contracts";
import { randomUUID } from "node:crypto";
import { loadProxyConfig, type ProxyConfig } from "../../../../lib/api-proxy";
import { proxyDocumentUpload } from "../../../../lib/upload-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let config: ProxyConfig | undefined;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
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
  const { documentId } = await params;
  return proxyDocumentUpload(request, documentId, config, {
    fetch: globalThis.fetch,
    log: (line) => console.error(line),
  });
}
