/**
 * DP-297 (ADR-030 D10 rule 6): the hand-off signal of a paid request. `onDispatch` fires once,
 * right after `fetch` was invoked (same synchronous turn) — never before, never for a request that
 * is not sent; an aborted signal sends nothing; a generation is never retried.
 */
import { describe, expect, it } from "vitest";
import { postJson } from "../../../src/ai/providers/http.js";
import { ProviderCallError } from "../../../src/ai/providers/types.js";

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const mapError = async (res: Response) => new ProviderCallError("provider_unavailable", res.status);

describe("DP-297: postJson hand-off", () => {
  it("signals the hand-off once, right after fetch was invoked", async () => {
    const order: string[] = [];
    const body = await postJson(
      async () => {
        order.push("fetch");
        return ok();
      },
      {
        url: "https://provider.test/v1",
        headers: {},
        signal: new AbortController().signal,
        body: { a: 1 },
        onDispatch: () => order.push("dispatch"),
      },
      mapError,
    );
    expect(body).toEqual({ ok: true });
    expect(order).toEqual(["fetch", "dispatch"]);
  });

  it("sends nothing and signals nothing when already aborted", async () => {
    let fetched = 0;
    let dispatched = 0;
    const c = new AbortController();
    c.abort();
    await expect(
      postJson(
        async () => {
          fetched++;
          return ok();
        },
        {
          url: "https://provider.test/v1",
          headers: {},
          signal: c.signal,
          body: {},
          onDispatch: () => dispatched++,
        },
        mapError,
      ),
    ).rejects.toMatchObject({ code: "timeout" });
    expect([fetched, dispatched]).toEqual([0, 0]);
  });

  it("never retries a generation, also after a 5xx", async () => {
    let fetched = 0;
    let dispatched = 0;
    await expect(
      postJson(
        async () => {
          fetched++;
          return new Response("{}", { status: 503 });
        },
        {
          url: "https://provider.test/v1",
          headers: {},
          signal: new AbortController().signal,
          body: {},
          onDispatch: () => dispatched++,
        },
        mapError,
      ),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect([fetched, dispatched]).toEqual([1, 1]);
  });
});
