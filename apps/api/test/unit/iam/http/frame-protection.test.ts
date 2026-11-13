// DP-014: clickjacking headers on API responses, and their registration before the security
// middleware (so refusals carry them too). The HTTP behaviour is covered by staff-auth.int.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  API_FRAME_PROTECTION_HEADERS,
  frameProtection,
} from "../../../../src/iam/http/frame-protection.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../src");

describe("API frame protection (DP-014)", () => {
  it("sets frame-ancestors 'none' and X-Frame-Options DENY, then continues", () => {
    const set = new Map<string, string>();
    const res = { setHeader: (k: string, v: string) => set.set(k.toLowerCase(), v) };
    let called = 0;
    frameProtection({} as IncomingMessage, res as unknown as ServerResponse, () => called++);
    expect(called).toBe(1);
    expect(set.get("x-frame-options")).toBe("DENY");
    expect(set.get("content-security-policy")).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    expect(Object.keys(API_FRAME_PROTECTION_HEADERS)).toHaveLength(2);
  });

  it("is registered before the security middleware in the app factory", () => {
    const factory = readFileSync(path.join(SRC, "app.factory.ts"), "utf8");
    const frame = factory.indexOf("app.use(frameProtection)");
    const security = factory.indexOf("app.use(createSecurityMiddleware(");
    expect(frame).toBeGreaterThan(-1);
    expect(security).toBeGreaterThan(frame);
  });
});
