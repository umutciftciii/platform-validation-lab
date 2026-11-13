import { currentLeadFormTexts, privacyDeployEnv, privacyPublication } from "@dream/contracts";

/**
 * DP-095 D-T7: the current texts of the lead form, for a page that still shows older ones (the
 * API refused the form with LEAD_TEXT_OUTDATED). The form shows them and asks for a fresh
 * confirmation; an earlier tick is never reused. Same production gate as the form (D-T5).
 */
export function GET(): Response {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!privacyPublication(privacyDeployEnv(process.env["DP_DEPLOY_ENV"])).publish) {
    return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers });
  }
  return new Response(JSON.stringify(currentLeadFormTexts()), { status: 200, headers });
}
