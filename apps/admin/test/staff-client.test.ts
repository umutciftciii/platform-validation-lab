// DP-076 revision / DP-107: browser helpers of "Staff and access".
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignRole, endOfDayIso, revokeRole, RULE_MESSAGES } from "../lib/staff-client";

const reply = (status: number, code: string, rule?: string) =>
  new Response(
    JSON.stringify({
      error: {
        code,
        message: "x",
        requestId: "r",
        details: rule ? [{ path: "(root)", rule }] : [],
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );

describe("staff client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns an optional end date into the end of that day, or nothing", () => {
    expect(endOfDayIso("2027-01-31")).toBe("2027-01-31T23:59:00.000Z");
    expect(endOfDayIso("")).toBeUndefined();
    expect(endOfDayIso("31/01/2027")).toBeUndefined();
  });

  it("posts to the direct assignment routes and explains refusals", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(reply(409, "CONFLICT_STATE", "already_assigned"));
    expect(await assignRole("u-1", { roleKey: "sales_crm_user", siteId: "s-1" })).toEqual({
      ok: false,
      status: 409,
      message: RULE_MESSAGES["already_assigned"],
      stepUp: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/staff/u-1/roles");
    fetchMock.mockResolvedValueOnce(reply(403, "FORBIDDEN"));
    const denied = await assignRole("u-1", { roleKey: "site_admin", siteId: "s-1" });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.message).toMatch(/may not make this change/);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await revokeRole("a-1")).toEqual({ ok: true, data: undefined });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/admin/role-assignments/a-1/revoke");
  });
});
