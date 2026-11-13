import { healthResponse } from "@dream/contracts";
import { connection } from "next/server";
import pkg from "../../../package.json";

// Liveness probe for Docker and the smoke test. Rendered per request, never cached.
export async function GET() {
  await connection();
  return Response.json(healthResponse("web-corporate", pkg.version), {
    headers: { "Cache-Control": "no-store" },
  });
}
