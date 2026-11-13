// DP-014: the admin console refuses to be framed on every path (regression for the DP-U finding
// that /login rendered inside a same-origin iframe). HTTP behaviour: tools/smoke (frame group).
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { ALL_PATHS, FRAME_PROTECTION_HEADERS } from "../lib/security-headers";

describe("admin frame protection (DP-014)", () => {
  it("declares frame-ancestors 'none' and X-Frame-Options DENY", () => {
    const map = Object.fromEntries(FRAME_PROTECTION_HEADERS.map((h) => [h.key, h.value]));
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });

  it("applies them to every path through next.config headers()", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const catchAll = rules.filter((r) => r.source === ALL_PATHS);
    expect(ALL_PATHS).toBe("/:path*");
    expect(catchAll).toHaveLength(1);
    expect(catchAll[0]!.headers).toEqual([...FRAME_PROTECTION_HEADERS]);
    // No rule may weaken them for a sub-path.
    for (const r of rules) {
      for (const h of r.headers) {
        if (/^(x-frame-options|content-security-policy)$/i.test(h.key)) {
          expect(FRAME_PROTECTION_HEADERS).toContainEqual(h);
        }
      }
    }
  });
});
