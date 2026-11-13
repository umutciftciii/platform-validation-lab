// DP-114: single-use credential links in the browser (/enrol, /reset). The token is taken from
// the fragment once, kept per tab, never in a URL or a log, and a reload after the last step says
// "done" rather than "invalid link".
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimLink,
  confirmAuthenticator,
  followLink,
  forgetLink,
  fragmentNeedsCleaning,
  groupSecret,
  inspectLink,
  KIND_COPY,
  POLICY_MESSAGES,
  proveCurrentPassword,
  recoveryCodesText,
  rememberDone,
  rememberInvalid,
  resetPassword,
  setNewPassword,
  startAuthenticator,
  toLinkCall,
  tokenFromFragment,
} from "../lib/credential-link";
import { qrPath } from "../lib/qr";
import { ENROL_KINDS, PASSWORD_POLICY_DETAILS } from "@dream/contracts";

const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2); // 43 base64url characters
const OTHER = "Q".repeat(43);

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const errorReply = (status: number, code: string, details: unknown[] = []) =>
  new Response(JSON.stringify({ error: { code, message: "x", requestId: "r", details } }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("fragment token", () => {
  it("reads only a well-formed token from #t=", () => {
    expect(TOKEN).toHaveLength(43);
    expect(tokenFromFragment(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment(`#x=1&t=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment(`#t=${TOKEN}x`)).toBeNull();
    expect(tokenFromFragment("#t=short")).toBeNull();
    expect(tokenFromFragment("")).toBeNull();
  });

  it("asks to clean any t= attempt out of the address bar, even a broken one", () => {
    expect(fragmentNeedsCleaning(`#t=${TOKEN}`)).toBe(true);
    expect(fragmentNeedsCleaning("#t=broken")).toBe(true);
    expect(fragmentNeedsCleaning("#section")).toBe(false);
    expect(fragmentNeedsCleaning("")).toBe(false);
  });
});

describe("per-tab link state (reload and back navigation)", () => {
  it("remembers the link token so a reload continues the flow", () => {
    const store = memoryStore();
    expect(claimLink(`#t=${TOKEN}`, store, "enrol")).toEqual({ status: "token", token: TOKEN });
    // Reload: the fragment is gone (replaceState), the tab still knows the token.
    expect(claimLink("", store, "enrol")).toEqual({ status: "token", token: TOKEN });
    // The reset page keeps its own entry.
    expect(claimLink("", store, "reset")).toEqual({ status: "none" });
  });

  it("after the last step only a done marker stays: a reload says done, not invalid", () => {
    const store = memoryStore();
    claimLink(`#t=${TOKEN}`, store, "enrol");
    rememberDone(store, "enrol", "recovery");
    expect(claimLink("", store, "enrol")).toEqual({ status: "done", kind: "recovery" });
    expect([...store.map.values()].join()).not.toContain(TOKEN);
  });

  it("remembers a refused link, and a new link always wins", () => {
    const store = memoryStore();
    claimLink(`#t=${TOKEN}`, store, "enrol");
    rememberInvalid(store, "enrol");
    expect(claimLink("", store, "enrol")).toEqual({ status: "invalid" });
    expect([...store.map.values()].join()).not.toContain(TOKEN);
    expect(claimLink(`#t=${OTHER}`, store, "enrol")).toEqual({ status: "token", token: OTHER });
    rememberDone(store, "enrol", "invitation");
    expect(claimLink(`#t=${TOKEN}`, store, "enrol")).toEqual({ status: "token", token: TOKEN });
    forgetLink(store, "enrol");
    expect(claimLink("", store, "enrol")).toEqual({ status: "none" });
  });

  it("ignores tampered or unreadable entries and works without storage", () => {
    const store = memoryStore();
    store.setItem("dp-admin-enrol-link", "{not json");
    expect(claimLink("", store, "enrol")).toEqual({ status: "none" });
    store.setItem("dp-admin-enrol-link", JSON.stringify({ t: "short" }));
    expect(claimLink("", store, "enrol")).toEqual({ status: "none" });
    store.setItem("dp-admin-enrol-link", JSON.stringify({ done: "god_mode" }));
    expect(claimLink("", store, "enrol")).toEqual({ status: "none" });
    expect(claimLink(`#t=${TOKEN}`, null, "enrol")).toEqual({ status: "token", token: TOKEN });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(claimLink(`#t=${TOKEN}`, throwing, "enrol")).toEqual({ status: "token", token: TOKEN });
    expect(claimLink("", throwing, "enrol")).toEqual({ status: "none" });
  });
});

describe("API calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the existing enrolment and reset endpoints, token only in the JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    await inspectLink(TOKEN);
    await setNewPassword(TOKEN, "new-pass");
    await proveCurrentPassword(TOKEN, "current-pass");
    await startAuthenticator(TOKEN);
    await confirmAuthenticator(TOKEN, "123456");
    await resetPassword(TOKEN, "new-pass", { recoveryCode: "ABCDE-12345" });
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      init: init as RequestInit,
    }));
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/auth/staff/enrol/inspect",
      "/api/v1/auth/staff/enrol/password",
      "/api/v1/auth/staff/enrol/password",
      "/api/v1/auth/staff/enrol/mfa/setup",
      "/api/v1/auth/staff/enrol/mfa/confirm",
      "/api/v1/auth/staff/password/reset",
    ]);
    expect(calls.map((c) => c.body)).toEqual([
      { token: TOKEN },
      { token: TOKEN, password: "new-pass" },
      { token: TOKEN, currentPassword: "current-pass" },
      { token: TOKEN },
      { token: TOKEN, code: "123456" },
      { token: TOKEN, newPassword: "new-pass", recoveryCode: "ABCDE-12345" },
    ]);
    for (const c of calls) {
      expect(c.url).not.toContain(TOKEN);
      expect(c.init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    }
  });

  it("maps answers to what the page does next", async () => {
    expect(await toLinkCall(errorReply(400, "AUTH_TOKEN_INVALID"))).toMatchObject({
      ok: false,
      failure: "link",
    });
    expect(
      await toLinkCall(errorReply(422, "AUTH_PASSWORD_POLICY", ["breached", "contains_identity"])),
    ).toMatchObject({ failure: "policy", details: ["breached", "contains_identity"] });
    expect(await toLinkCall(errorReply(401, "AUTH_INVALID_CREDENTIALS"))).toMatchObject({
      failure: "credentials",
    });
    expect(await toLinkCall(errorReply(401, "AUTH_MFA_INVALID"))).toMatchObject({
      failure: "code",
    });
    expect(await toLinkCall(errorReply(409, "CONFLICT_STATE"))).toMatchObject({ failure: "state" });
    expect(await toLinkCall(new Response("", { status: 429 }))).toMatchObject({ failure: "rate" });
    expect(await toLinkCall(new Response("<html>", { status: 502 }))).toMatchObject({
      failure: "other",
    });
    expect(
      await toLinkCall(
        errorReply(400, "VALIDATION_FAILED", [{ path: "password", rule: "too_big" }]),
      ),
    ).toMatchObject({ failure: "other", details: ["too_big"] });
    expect(
      await toLinkCall(new Response(JSON.stringify({ recoveryCodes: [] }), { status: 200 })),
    ).toEqual({ ok: true, data: { recoveryCodes: [] } });
  });

  it("reports an unreachable API without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await inspectLink(TOKEN)).toMatchObject({ ok: false, failure: "network" });
  });

  it("has a message for every password rule and a text for every link kind", () => {
    for (const rule of PASSWORD_POLICY_DETAILS) expect(POLICY_MESSAGES[rule]).toBeTruthy();
    for (const kind of ENROL_KINDS) expect(KIND_COPY[kind].title).toBeTruthy();
  });
});

describe("presentation", () => {
  it("groups the manual key in fours", () => {
    expect(groupSecret("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
  });

  it("writes recovery codes into a plain text file with the masked address only", () => {
    const text = recoveryCodesText(["ABCDE-12345", "FGHIJ-67890"], "r***@staff.dp.test");
    expect(text).toContain("ABCDE-12345\nFGHIJ-67890");
    expect(text).toContain("r***@staff.dp.test");
  });

  it("draws the QR code locally: square, with the three finder patterns", () => {
    const uri =
      "otpauth://totp/Dream%20Petroleum%3Aroot%40staff.dp.test?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Dream+Petroleum&algorithm=SHA1&digits=6&period=30";
    const qr = qrPath(uri);
    // Version 7 or larger (49+ modules) plus a quiet zone of 4 modules on each side.
    expect(qr.size).toBeGreaterThanOrEqual(45 + 8);
    expect(qr.d).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    // Finder pattern: a 7-module dark run starts at the quiet zone in the top-left corner.
    expect(qr.d).toContain("M4 4h7v1h-7z");
    expect(qr.d).toContain(`M${qr.size - 11} 4h7v1h-7z`);
    expect(qr.d).not.toContain("ABCDEFGHIJKLMNOP");
  });
});

describe("followLink (address bar and history)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeWindow(hash: string) {
    const listeners = new Map<string, () => void>();
    const store = memoryStore();
    const win = {
      location: { hash, pathname: "/enrol", search: "" },
      history: {
        replaceState: vi.fn((_s: unknown, _t: string, url: string) => {
          win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
        }),
      },
      sessionStorage: store,
      addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    vi.stubGlobal("window", win);
    return { win, listeners, store };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("removes the token from the address bar at once, without a new history entry", async () => {
    const { win } = fakeWindow(`#t=${TOKEN}`);
    const states: unknown[] = [];
    const stop = followLink("enrol", (s) => states.push(s));
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/enrol");
    expect(win.location.hash).toBe("");
    await flush();
    expect(states).toEqual([{ status: "token", token: TOKEN }]);
    stop();
  });

  it("handles a link pasted into a tab already on the page (fragment change, no reload)", async () => {
    const { win, listeners } = fakeWindow("");
    const states: unknown[] = [];
    const stop = followLink("enrol", (s) => states.push(s));
    await flush();
    expect(states).toEqual([{ status: "none" }]);
    win.location.hash = `#t=${OTHER}`;
    listeners.get("hashchange")?.();
    expect(win.location.hash).toBe("");
    await flush();
    expect(states.at(-1)).toEqual({ status: "token", token: OTHER });
    // An unrelated fragment change does not restart the flow.
    win.location.hash = "#top";
    listeners.get("hashchange")?.();
    await flush();
    expect(states).toHaveLength(2);
    stop();
    expect(listeners.has("hashchange")).toBe(false);
  });
});
