// DP-110 (ADR-018): browser helpers of the system owner console.
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeModule, confirmDesignation, protectedAudit, verifyChain } from "../lib/owner-client";
import { RULE_MESSAGES } from "../lib/staff-client";

const reply = (status: number, code: string, rule?: string) =>
  new Response(
    JSON.stringify({
      error: {
        code,
        message: "x",
        requestId: "r",
        details: rule ? [{ path: "enabled", rule }] : [],
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );

describe("owner client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("switches a module through the owner route and explains a core-module refusal", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(400, "VALIDATION_FAILED", "core_module"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await changeModule("audit", "site-1", false, "never");
    expect(res).toMatchObject({ ok: false, status: 400, message: RULE_MESSAGES["core_module"] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/owner/modules/audit/sites/site-1");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      enabled: false,
      reason: "never",
    });
  });

  it("reports a step-up request so the console can ask for an authenticator code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(reply(403, "AUTH_STEP_UP_REQUIRED"))),
    );
    expect((await verifyChain()).ok).toBe(false);
    expect(await protectedAudit(10)).toMatchObject({ ok: false, stepUp: true });
    expect(await changeModule("crm", "s", true, "pilot")).toMatchObject({ stepUp: true });
  });

  it("pages the protected audit trail with `before` and confirms a designation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextBefore: null }), { status: 200 }),
      )
      .mockResolvedValueOnce(reply(409, "CONFLICT_STATE", "already_designated"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await protectedAudit(42)).toEqual({ ok: true, data: { items: [], nextBefore: null } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/owner/audit?limit=50&before=42");
    expect(await confirmDesignation("t", "p")).toMatchObject({
      ok: false,
      message: RULE_MESSAGES["already_designated"],
    });
  });
});
