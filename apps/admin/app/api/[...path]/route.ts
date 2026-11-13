// Same-origin API proxy of the admin app (F1-002 Group 2; ADR-013 D2, design 2.4). The logic and
// its contract live in lib/api-proxy.ts; this file only binds it to the HTTP methods. The static
// /api/health route takes precedence over this catch-all.
import { errorBody } from "@dream/contracts";
import { randomUUID } from "node:crypto";
import { loadProxyConfig, proxyRequest, type ProxyConfig } from "../../../lib/api-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let config: ProxyConfig | undefined;

async function handle(request: Request): Promise<Response> {
  try {
    config ??= loadProxyConfig(process.env);
  } catch (error) {
    // The message names the variable, never its value.
    console.error(`api proxy: ${(error as Error).message}`);
    return Response.json(errorBody("BAD_GATEWAY", randomUUID()), {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return proxyRequest(request, config, {
    fetch: globalThis.fetch,
    log: (line) => console.error(line),
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
