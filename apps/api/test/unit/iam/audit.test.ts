import { describe, expect, it } from "vitest";
import { buildAuditEvent, maskMetadata } from "../../../src/iam/audit.js";
import { siteAllowed, siteFilter } from "../../../src/iam/site-scope.js";

describe("audit metadata masking", () => {
  it("redacts secrets and masks e-mail addresses at any depth", () => {
    const masked = maskMetadata({
      email: "Jane.Doe@example.com",
      password: "hunter2",
      nested: { accessToken: "abc", list: ["ops@dreampetroleum.com", 3], mfaCode: "123456" },
      passwordHash: "$argon2id$v=19$...",
      role: "site_admin",
    });
    expect(masked).toEqual({
      email: "J***@example.com",
      password: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        list: ["o***@dreampetroleum.com", 3],
        mfaCode: "[REDACTED]",
      },
      passwordHash: "[REDACTED]",
      role: "site_admin",
    });
    expect(JSON.stringify(masked)).not.toMatch(/hunter2|Jane\.Doe|abc"|123456/);
  });

  it("limits depth and string length", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(maskMetadata(deep))).toContain("[TRUNCATED]");
    expect((maskMetadata({ s: "x".repeat(2000) })["s"] as string).length).toBeLessThan(600);
  });
});

describe("buildAuditEvent", () => {
  it("builds a masked, scope-consistent event", () => {
    const e = buildAuditEvent({
      actorType: "USER",
      actorUserId: "u1",
      action: "role_assignment.grant",
      resourceType: "role_assignment",
      resourceId: "ra1",
      scopeType: "SITE",
      siteId: "s1",
      outcome: "SUCCESS",
      metadata: { assignee: "a@b.co" },
    });
    expect(e).toMatchObject({ siteId: "s1", metadata: { assignee: "a***@b.co" }, requestId: null });
  });

  it.each([
    [{ action: "Grant" }, /action/],
    [{ actorType: "USER", actorUserId: null }, /USER actor/],
    [{ actorType: "SYSTEM", actorUserId: "u1" }, /USER actor/],
    [{ scopeType: "SITE", siteId: null }, /SITE scope/],
    [{ scopeType: "PLATFORM", siteId: "s1" }, /SITE scope/],
  ] as const)("rejects inconsistent events %#", (patch, message) => {
    const base = {
      actorType: "SYSTEM" as const,
      action: "iam.catalog_sync",
      resourceType: "catalog",
      scopeType: "PLATFORM" as const,
      outcome: "SUCCESS" as const,
    };
    expect(() => buildAuditEvent({ ...base, ...patch })).toThrow(message);
  });
});

describe("site scope filters", () => {
  const scope = { siteIds: ["bv"], includePlatform: false };

  it("filters site-bound models to the allowed sites", () => {
    expect(siteFilter("Membership", scope)).toEqual({ siteId: { in: ["bv"] } });
    // DP-108: audit events are limited to the STANDARD stream as well.
    expect(siteFilter("AuditEvent", { ...scope, includePlatform: true })).toEqual({
      AND: [{ OR: [{ siteId: { in: ["bv"] } }, { siteId: null }] }, { stream: "STANDARD" }],
    });
    expect(siteFilter("AuditEvent", scope)).toEqual({
      AND: [{ siteId: { in: ["bv"] } }, { stream: "STANDARD" }],
    });
    // Membership has no platform rows: includePlatform never widens it.
    expect(siteFilter("Membership", { ...scope, includePlatform: true })).toEqual({
      siteId: { in: ["bv"] },
    });
  });

  it("allows writes only inside the scope", () => {
    expect(siteAllowed("Membership", scope, "bv")).toBe(true);
    expect(siteAllowed("Membership", scope, "com")).toBe(false);
    expect(siteAllowed("Membership", scope, undefined)).toBe(false);
    expect(siteAllowed("AuditEvent", scope, null)).toBe(false);
    expect(siteAllowed("AuditEvent", { ...scope, includePlatform: true }, null)).toBe(true);
    expect(siteAllowed("Membership", { siteIds: [], includePlatform: true }, null)).toBe(false);
  });
});
