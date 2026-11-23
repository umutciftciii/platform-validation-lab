import { privacyDeployEnv, privacyPublication } from "@dream/contracts";

import { leadFormTextsAnswer } from "@/lib/form-texts";
import { visibleLocales } from "@/lib/public-locales";

/**
 * DP-095 D-T7: the current texts of the lead form, for a page that still shows older ones (the
 * API refused the form with LEAD_TEXT_OUTDATED). The form shows them and asks for a fresh
 * confirmation; an earlier tick is never reused. Same production gate as the form (D-T5).
 *
 * ML-10: `?locale=` names the page's language; without it the English texts (unchanged). A
 * language that is not public, or whose texts are still under DP-095 review, is a 404: its draft
 * texts never leave the code.
 */
export async function GET(request: Request): Promise<Response> {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!privacyPublication(privacyDeployEnv(process.env["DP_DEPLOY_ENV"])).publish) {
    return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers });
  }
  const search = new URL(request.url).searchParams;
  // The public languages are read only when a language is asked for (fail closed: default only).
  const answer = leadFormTextsAnswer(search, search.has("locale") ? await visibleLocales() : []);
  return answer.status === 200
    ? new Response(JSON.stringify(answer.body), { status: 200, headers })
    : new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers });
}
