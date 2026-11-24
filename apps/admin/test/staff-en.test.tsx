// ML-12e (DP-243) EN regression of Admin > Staff and access: the page (every account status, platform
// and site roles, the system owner, time-limited roles ending soon or later, the viewer's own row,
// memberships of every status, a read-only viewer, one account, an empty list, 403 / 500 / 404),
// the "Give a role" form (first, filled with a platform or a site role, busy, error, success, no
// usable roles), the role removal confirmation (idle, confirming, busy, error), the invitation form
// with its step-up code (first, filled, code asked, busy, error, enrolment link) and the browser
// helpers' messages (lib/staff-client.ts: rule messages, FORBIDDEN, the API's default messages,
// network and unknown failures, the step-up flag). Every render goes through
// support/en-baseline-render: it is compared with the HTML recorded on private main 10dec17 (before
// ML-12e) in fixtures/catalog-en/staff-en.json.gz (record with ML12E_RECORD_EN=1, this file only).
//
// The client parts keep their state in useState. A static render shows only the first state, so
// `react`'s useState is replaced here by a queue: a test lists the states the next components start
// in (in render order; KEEP = the component's own initial value). The setters record what they were
// given, so a submit handler called outside React shows the message it would set.
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignableRole, StaffMember } from "@dream/contracts";
import { ERROR_CODES } from "@dream/contracts";
import { renderToStaticMarkup } from "./support/en-baseline-render";
import {
  BV,
  CORP,
  NOW,
  ROLES,
  SITES,
  STAFF,
  STAFF_API,
  VIEWER,
  id,
  list,
} from "./support/staff-fixtures";

const KEEP = Symbol("keep");
const queue: unknown[] = [];
const sets: unknown[] = [];
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    const next = queue.length ? queue.shift() : KEEP;
    return [next === KEEP ? initial : next, (v: unknown) => void sets.push(v)];
  };
  return { ...react, default: { ...react, useState }, useState };
});

const reads = new Map<string, unknown>();
const FAIL = Symbol("fail");
const FORBIDDEN = Symbol("forbidden");
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(path);
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    if (v === FORBIDDEN) return { ok: false, status: 403, code: "FORBIDDEN" };
    return { ok: true, data: schema.parse(v) };
  },
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const pageModule = await import("../app/(console)/staff/page");
const StaffPage = pageModule.default;
const { AssignRoleForm, InviteForm, RemoveRoleButton } =
  await import("../components/staff/staff-actions");
const client = await import("../lib/staff-client");

const page = async () => renderToStaticMarkup((await StaffPage()) as ReactElement);
const assign = (over: Partial<Parameters<typeof AssignRoleForm>[0]> = {}) =>
  renderToStaticMarkup(
    <AssignRoleForm staff={STAFF} roles={ROLES} sites={SITES} viewerId={VIEWER} {...over} />,
  );
const invite = (over: Partial<Parameters<typeof InviteForm>[0]> = {}) =>
  renderToStaticMarkup(<InviteForm sites={SITES} roles={ROLES} {...over} />);
const remove = () =>
  renderToStaticMarkup(
    <RemoveRoleButton assignmentId={id(104)} label="Sales / CRM User from Sam Sales" />,
  );
const table = (value: unknown) => renderToStaticMarkup(<pre>{JSON.stringify(value, null, 1)}</pre>);

const reply = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const errorReply = (status: number, code: string, rule?: string) =>
  reply(status, {
    error: {
      code,
      message: "x",
      requestId: "r",
      details: rule ? [{ path: "(root)", rule }] : [],
    },
  });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  reads.clear();
  queue.length = 0;
  sets.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

// --- page -------------------------------------------------------------------------------------------

describe("Staff and access page (EN)", () => {
  it("names the page", async () => {
    // ML-12e: `metadata` became generateMetadata() (same title).
    table(await pageModule.generateMetadata());
  });

  it("lists every account status, role kind, end date and membership", async () => {
    reads.set(STAFF_API, list());
    const html = await page();
    expect(html).toContain("People and their roles");
    expect(html).toContain("7 staff accounts");
    expect(html).toContain("Ends soon");
    expect(html).toContain("You");
    expect(html).toContain("All sites");
    expect(html).toContain("No roles.");
  });

  it("is read-only for a viewer who may give or remove nothing", async () => {
    reads.set(
      STAFF_API,
      list({
        roles: [ROLES[4] as AssignableRole],
        staff: STAFF.map((p) => ({
          ...p,
          roles: p.roles.map((r) => ({ ...r, canRevoke: false })),
        })),
      }),
    );
    const html = await page();
    expect(html).toContain("Your roles do not allow you to give roles to others.");
    expect(html).not.toContain(">Remove<");
  });

  it("counts one account and shows an empty list", async () => {
    reads.set(STAFF_API, list({ staff: [STAFF[0] as StaffMember] }));
    expect(await page()).toContain("1 staff account");
    reads.set(STAFF_API, list({ staff: [], roles: [], sites: [] }));
    expect(await page()).toContain("0 staff accounts");
  });

  it("shows a refusal, a load error and a missing route", async () => {
    reads.set(STAFF_API, FORBIDDEN);
    expect(await page()).toContain("Not available for your role");
    reads.set(STAFF_API, FAIL);
    expect(await page()).toContain("Staff could not be loaded");
    reads.delete(STAFF_API);
    await page();
  });
});

// --- give a role ------------------------------------------------------------------------------------

describe("Give a role form (EN)", () => {
  it("starts empty, and explains when no role can be given", () => {
    expect(assign()).toContain("Choose a person…");
    expect(assign({ roles: [] })).toContain("do not allow you");
    expect(assign({ roles: [ROLES[4] as AssignableRole] })).toContain("do not allow you");
  });

  it("asks no site for a platform role, and a site for a site role", () => {
    // person, roleKey, siteId, end, busy, message
    queue.push(id(3), "platform_super_admin", KEEP, KEEP, KEEP, KEEP);
    expect(assign()).not.toContain(">Site<");
    queue.push(id(3), "site_admin", KEEP, KEEP, KEEP, KEEP);
    expect(assign()).toContain(">Site<");
    queue.push(id(3), "site_admin", CORP, "2027-01-31", KEEP, KEEP);
    assign();
    queue.push(id(3), "sales_crm_user", KEEP, KEEP, KEEP, KEEP);
    assign();
  });

  it("shows busy, an error and a success", () => {
    queue.push(id(3), "site_admin", BV, KEEP, true, KEEP);
    assign();
    queue.push(id(3), "site_admin", BV, KEEP, KEEP, {
      kind: "error",
      text: client.RULE_MESSAGES["already_assigned"],
    });
    assign();
    queue.push(id(3), "site_admin", BV, KEEP, KEEP, {
      kind: "success",
      text: "Sam Sales now has the role Site Admin.",
    });
    assign();
  });

  it("words the success message the submit sets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(201, { assignment: {}, replacedAssignmentId: null })),
    );
    const messages: unknown[] = [];
    for (const [person, roleKey] of [
      [id(3), "site_admin"],
      [id(7), "platform_super_admin"],
      [VIEWER, "platform_product_manager"], // not in the list of people: "The person"
    ] as const) {
      let submit: ((e: { preventDefault(): void }) => Promise<void>) | null = null;
      function Grab() {
        const form = AssignRoleForm({
          staff: STAFF,
          roles: ROLES,
          sites: SITES,
          viewerId: VIEWER,
        }) as ReactElement<{ onSubmit: typeof submit }>;
        submit = form.props.onSubmit;
        return null;
      }
      queue.push(person, roleKey, KEEP, KEEP, KEEP, KEEP);
      renderToStaticMarkup(<Grab />);
      sets.length = 0;
      await (submit as unknown as (e: { preventDefault(): void }) => Promise<void>)({
        preventDefault: () => undefined,
      });
      messages.push(sets.find((v) => typeof v === "object" && v !== null && "kind" in v));
    }
    expect(table(messages)).toContain("now has the role");
  });
});

// --- remove a role ----------------------------------------------------------------------------------

describe("Remove a role (EN)", () => {
  it("asks for confirmation, is busy and shows an error", () => {
    // confirming, busy, error
    expect(remove()).toContain("Remove Sales / CRM User from Sam Sales");
    queue.push(true, KEEP, KEEP);
    expect(remove()).toContain("Keep");
    queue.push(true, true, KEEP);
    remove();
    queue.push(true, KEEP, client.RULE_MESSAGES["db_guard"]);
    remove();
    queue.push(KEEP, KEEP, "The last platform administrator cannot be removed.");
    remove();
  });
});

// --- invite -----------------------------------------------------------------------------------------

describe("Invite a staff member form (EN)", () => {
  // email, name, siteId, roleKey, code, needCode, busy, error, link
  it("starts empty and lists the roles of the chosen site", () => {
    expect(invite()).toContain("No role yet");
    queue.push("new.person@fixture.invalid", "New Person", CORP, "site_admin");
    invite();
    queue.push("new.person@fixture.invalid", "New Person", BV, "sales_crm_user");
    invite();
    invite({ sites: [], roles: [] });
  });

  it("asks for an authenticator code, and is busy", () => {
    queue.push("new.person@fixture.invalid", "New Person", BV, KEEP, KEEP, true);
    expect(invite()).toContain("Authenticator code");
    queue.push("new.person@fixture.invalid", "New Person", BV, KEEP, "123 456", true);
    expect(invite()).toContain("Confirm and invite");
    queue.push("new.person@fixture.invalid", "New Person", BV, KEEP, KEEP, KEEP, true);
    invite();
    queue.push("new.person@fixture.invalid", "New Person", BV, KEEP, "123456", true, true);
    invite();
  });

  it("shows an error and the one-time enrolment link", () => {
    queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, true, KEEP, "The verification code is incorrect.");
    invite();
    queue.push(KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, KEEP, client.RULE_MESSAGES["unknown_role"]);
    invite();
    queue.push(
      KEEP,
      KEEP,
      KEEP,
      KEEP,
      KEEP,
      KEEP,
      KEEP,
      KEEP,
      "https://admin.fixture.invalid/enrol#token=abc123",
    );
    expect(invite()).toContain("Invitation created.");
  });
});

// --- browser helper messages ------------------------------------------------------------------------

describe("Staff client messages (EN)", () => {
  it("lists the rule messages", () => {
    table(client.RULE_MESSAGES);
  });

  it("explains every refusal a call can meet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const results: Record<string, unknown> = {};
    for (const rule of Object.keys(client.RULE_MESSAGES)) {
      fetchMock.mockResolvedValueOnce(errorReply(409, "CONFLICT_STATE", rule));
      results[`rule:${rule}`] = await client.assignRole(id(3), { roleKey: "site_admin" });
    }
    for (const code of ERROR_CODES) {
      fetchMock.mockResolvedValueOnce(errorReply(400, code));
      results[`code:${code}`] = await client.revokeRole(id(104));
    }
    fetchMock.mockResolvedValueOnce(errorReply(403, "AUTH_STEP_UP_REQUIRED"));
    results["invite:step-up"] = await client.inviteStaff({
      email: "x@fixture.invalid",
      displayName: "X",
      siteId: BV,
    });
    fetchMock.mockResolvedValueOnce(errorReply(401, "AUTH_MFA_INVALID"));
    results["step-up:wrong-code"] = await client.stepUp("000000");
    fetchMock.mockResolvedValueOnce(errorReply(400, "VALIDATION_FAILED", "not_a_known_rule"));
    results["unknown-rule"] = await client.assignRole(id(3), { roleKey: "site_admin" });
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    results["unreadable"] = await client.assignRole(id(3), { roleKey: "site_admin" });
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    results["unreachable"] = await client.revokeRole(id(104));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    results["no-content"] = await client.revokeRole(id(104));
    expect(table(results)).toContain("The admin API cannot be reached.");
  });
});
