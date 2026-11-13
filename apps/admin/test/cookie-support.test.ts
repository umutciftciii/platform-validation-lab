// DP-119: Safari over plain http drops the Secure sign-in cookies; the sign-in page says so.
import { describe, expect, it } from "vitest";
import { messageFor } from "../components/auth/login-form";
import { COOKIES_BLOCKED_MESSAGE, secureCookiesBlocked } from "../lib/cookie-support";

/** A cookie jar that keeps or drops Secure cookies, like a browser on http://localhost. */
function jar(keepsSecure: boolean) {
  const store = new Map<string, string>();
  return {
    store,
    get cookie() {
      return [...store].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split(/;\s*/);
      const [name, value] = (pair ?? "").split("=") as [string, string];
      if (attrs.includes("Secure") && !keepsSecure) return;
      if (attrs.some((a) => a === "Max-Age=0")) store.delete(name);
      else store.set(name, value);
    },
  };
}

describe("secure cookie probe", () => {
  it("passes where Secure cookies are kept and leaves nothing behind", () => {
    const j = jar(true);
    expect(secureCookiesBlocked(j)).toBe(false);
    expect(j.store.size).toBe(0);
  });

  it("reports a browser that drops them", () => {
    expect(secureCookiesBlocked(jar(false))).toBe(true);
  });

  it("treats an inaccessible cookie jar as blocked", () => {
    const broken = {
      get cookie(): string {
        throw new Error("denied");
      },
      set cookie(_v: string) {
        throw new Error("denied");
      },
    };
    expect(secureCookiesBlocked(broken)).toBe(true);
  });
});

describe("second step without the challenge cookie", () => {
  const reply = (details: unknown[]) =>
    new Response(
      JSON.stringify({
        error: { code: "AUTH_CHALLENGE_EXPIRED", message: "x", requestId: "r", details },
      }),
      { status: 401 },
    );

  it("explains a dropped cookie instead of an expired attempt", async () => {
    expect((await messageFor(reply([{ path: "cookie", rule: "missing" }]))).text).toBe(
      COOKIES_BLOCKED_MESSAGE,
    );
    expect((await messageFor(reply([]))).text).toMatch(/expired/);
  });
});
