// DP-114: the credential link pages are public, render only the frame on the server (the token
// never reaches it), and send no Referer and no cacheable copy.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EnrolPage from "../app/enrol/page";
import ResetPage from "../app/reset/page";
import nextConfig from "../next.config";
import { isPublicPath, needsLoginRedirect } from "../lib/route-guard";
import {
  CREDENTIAL_LINK_HEADERS,
  CREDENTIAL_LINK_PATHS,
  FRAME_PROTECTION_HEADERS,
} from "../lib/security-headers";

describe("credential link pages", () => {
  it.each(["/enrol", "/reset"])(
    "%s is public: a redirect to /login would carry the fragment",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
      expect(needsLoginRedirect(path, false)).toBe(false);
    },
  );

  it("does not open look-alike paths", () => {
    for (const path of ["/enrolment", "/enrol-admin", "/resets", "/owner/confirm"]) {
      expect(needsLoginRedirect(path, false), path).toBe(true);
    }
  });

  it("server HTML is the frame with a loading state, no form and no secret", () => {
    const enrol = renderToStaticMarkup(<EnrolPage />);
    expect(enrol).toContain("Checking your link");
    expect(enrol).not.toMatch(/<form|type="password"|otpauth/);
    const reset = renderToStaticMarkup(<ResetPage />);
    expect(reset).toContain("Checking your link");
    expect(reset).not.toMatch(/<form|type="password"/);
  });

  it("sends no-referrer and no-store on both pages, frame protection stays", async () => {
    const rules = await nextConfig.headers!();
    for (const path of ["/enrol", "/reset"]) {
      const rule = rules.find((r) => r.source === path);
      expect(rule?.headers).toEqual([...CREDENTIAL_LINK_HEADERS]);
    }
    expect(CREDENTIAL_LINK_PATHS).toEqual(["/enrol", "/reset"]);
    const map = Object.fromEntries(CREDENTIAL_LINK_HEADERS.map((h) => [h.key, h.value]));
    expect(map["Referrer-Policy"]).toBe("no-referrer");
    expect(map["Cache-Control"]).toMatch(/no-store/);
    expect(rules.find((r) => r.source === "/:path*")?.headers).toEqual([
      ...FRAME_PROTECTION_HEADERS,
    ]);
  });
});
