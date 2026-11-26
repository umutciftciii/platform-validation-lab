/**
 * DP-289 (ADR-030 D4): the provider adapters against an isolated mock `fetch` — no network, no
 * paid call. Covers the request shape (URL, key header, never the key in a URL), paging, the
 * mapping of every failure to a result code (never the provider's text), the bounded retry, the
 * deadline, the response size limit, the key format and hint, the fake provider and the registry.
 */
import { describe, expect, it, vi } from "vitest";
import { AnthropicAdapter, ANTHROPIC_VERSION } from "../../../src/ai/providers/anthropic.js";
import { FakeAdapter } from "../../../src/ai/providers/fake.js";
import { GeminiAdapter } from "../../../src/ai/providers/gemini.js";
import { MAX_RESPONSE_BYTES, type FetchLike } from "../../../src/ai/providers/http.js";
import { keyFormatProblem, keyHint } from "../../../src/ai/providers/key-format.js";
import { OpenAiAdapter, openAiModel } from "../../../src/ai/providers/openai.js";
import { createAdapters } from "../../../src/ai/providers/registry.js";
import { ProviderCallError } from "../../../src/ai/providers/types.js";

const OPENAI_KEY = "sk-proj-TESTKEYabcdefghijklmnopqrstuv0001";
const ANTHROPIC_KEY = "sk-ant-api03-TESTKEYabcdefghijklmnop0002";
// Built at run time: a literal of this shape would (rightly) trip the secret scanner.
const GEMINI_KEY = ["AI", "za", "SyTESTKEY", "abcdefghijklmnopqrstuvw", "0003"].join("");
const PROVIDER_TEXT = "PROVIDER-SECRET-TEXT do not leak";

interface Call {
  url: string;
  headers: Record<string, string>;
  redirect: RequestInit["redirect"];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fetch that answers from a queue and records every request. */
function mockFetch(answers: (Response | Error | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const c: Call = {
      url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      redirect: init.redirect,
    };
    calls.push(c);
    const next = answers.shift();
    if (!next) throw new Error("no answer queued");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(c) : next;
  };
  return { calls, fetchImpl };
}

const opts = () => ({ signal: AbortSignal.timeout(5_000) });

async function failure(p: Promise<unknown>): Promise<ProviderCallError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderCallError);
    const err = e as ProviderCallError;
    // Never the provider's text, never a key.
    expect(err.message).toBe(err.code);
    expect(JSON.stringify(err)).not.toContain(PROVIDER_TEXT);
    return err;
  }
  throw new Error("expected a ProviderCallError");
}

describe("DP-289: OpenAI adapter", () => {
  it("lists models with the Bearer key and the project header, never the key in the URL", async () => {
    const { calls, fetchImpl } = mockFetch([
      json(200, {
        object: "list",
        data: [
          { id: "gpt-4.1-mini", object: "model", owned_by: "openai" },
          { id: "text-embedding-3-small", object: "model" },
          { id: "o4-mini", shutdown_date: "2020-01-01" },
          { id: "gpt-4o", shutdown_date: "2999-01-01" },
        ],
      }),
    ]);
    const models = await new OpenAiAdapter(fetchImpl).listModels(OPENAI_KEY, {
      ...opts(),
      projectRef: "proj_123",
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/models",
      redirect: "error",
      headers: { authorization: `Bearer ${OPENAI_KEY}`, "openai-project": "proj_123" },
    });
    expect(calls[0]!.url).not.toContain(OPENAI_KEY);
    expect(models.map((m) => [m.modelId, m.compatible, m.capabilities.lifecycle])).toEqual([
      ["gpt-4.1-mini", true, "active"],
      ["text-embedding-3-small", false, "active"],
      ["o4-mini", false, "retired"],
      ["gpt-4o", true, "deprecated"],
    ]);
  });

  it("maps 401, quota and rate limits to codes; retries one short Retry-After", async () => {
    const err = (status: number, body: unknown, headers?: Record<string, string>) =>
      json(status, { error: { message: PROVIDER_TEXT, ...((body as object) ?? {}) } }, headers);
    const a = (answers: Parameters<typeof mockFetch>[0]) =>
      new OpenAiAdapter(mockFetch(answers).fetchImpl).listModels(OPENAI_KEY, opts());
    expect((await failure(a([err(401, { code: "invalid_api_key" })]))).code).toBe(
      "credential_invalid",
    );
    expect((await failure(a([err(429, { code: "insufficient_quota" })]))).code).toBe(
      "quota_exceeded",
    );
    expect((await failure(a([err(403, {})]))).code).toBe("permission_denied");
    const long = await failure(
      a([err(429, { code: "rate_limit_exceeded" }, { "retry-after": "20" })]),
    );
    expect([long.code, long.retryAfterSec]).toEqual(["rate_limited", 20]);
    const { calls, fetchImpl } = mockFetch([
      err(429, { code: "rate_limit_exceeded" }, { "retry-after": "0" }),
      json(200, { data: [{ id: "gpt-4.1" }] }),
    ]);
    expect(await new OpenAiAdapter(fetchImpl).listModels(OPENAI_KEY, opts())).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("retries a 5xx once, then reports provider_unavailable", async () => {
    const { calls, fetchImpl } = mockFetch([json(503, {}), json(500, {})]);
    expect((await failure(new OpenAiAdapter(fetchImpl).listModels(OPENAI_KEY, opts()))).code).toBe(
      "provider_unavailable",
    );
    expect(calls).toHaveLength(2);
  });

  it("returns null for an unknown model and parses a retrieved one", async () => {
    const { calls, fetchImpl } = mockFetch([
      json(404, { error: { message: PROVIDER_TEXT } }),
      json(200, { id: "gpt-4.1" }),
    ]);
    const a = new OpenAiAdapter(fetchImpl);
    expect(await a.getModel(OPENAI_KEY, "nope/../x", opts())).toBeNull();
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models/nope%2F..%2Fx");
    expect((await a.getModel(OPENAI_KEY, "gpt-4.1", opts()))?.modelId).toBe("gpt-4.1");
  });

  it("classifies OpenAI model families", () => {
    for (const id of ["gpt-5", "gpt-4.1-nano", "o3", "chatgpt-4o-latest"]) {
      expect(openAiModel({ id })?.capabilities.textGeneration, id).toBe(true);
    }
    for (const id of [
      "whisper-1",
      "tts-1",
      "dall-e-3",
      "omni-moderation-latest",
      "gpt-4o-realtime-preview",
      "gpt-image-1",
      "davinci-002",
    ]) {
      expect(openAiModel({ id })?.capabilities.textGeneration, id).toBe(false);
    }
    expect(openAiModel({})).toBeNull();
  });
});

describe("DP-289: Anthropic adapter", () => {
  it("pages with limit/after_id and sends x-api-key and anthropic-version only", async () => {
    const { calls, fetchImpl } = mockFetch([
      json(200, {
        data: [
          {
            type: "model",
            id: "claude-opus-5-5",
            display_name: "Claude Opus 5.5",
            max_input_tokens: 200000,
            max_tokens: 64000,
            lifecycle: "active",
          },
        ],
        has_more: true,
        first_id: "claude-opus-5-5",
        last_id: "claude-opus-5-5",
      }),
      json(200, {
        data: [
          { type: "model", id: "claude-old", display_name: "Claude Old", lifecycle: "retired" },
        ],
        has_more: false,
        last_id: "claude-old",
      }),
    ]);
    const models = await new AnthropicAdapter(fetchImpl).listModels(ANTHROPIC_KEY, {
      ...opts(),
      projectRef: "wrkspc_1",
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5",
    ]);
    expect(calls[0]!.headers).toMatchObject({
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-workspace-id": "wrkspc_1",
    });
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(
      models.map((m) => [m.modelId, m.compatible, m.contextWindow, m.maxOutputTokens]),
    ).toEqual([
      ["claude-opus-5-5", true, 200000, 64000],
      ["claude-old", false, null, null],
    ]);
  });

  it("maps the error types; a spend-cap 429 (no Retry-After) is quota, not a wait", async () => {
    const e = (status: number, type: string, headers?: Record<string, string>) =>
      json(
        status,
        { type: "error", error: { type, message: PROVIDER_TEXT }, request_id: "req_1" },
        headers,
      );
    const a = (answers: Parameters<typeof mockFetch>[0]) =>
      new AnthropicAdapter(mockFetch(answers).fetchImpl).listModels(ANTHROPIC_KEY, opts());
    expect((await failure(a([e(401, "authentication_error")]))).code).toBe("credential_invalid");
    expect((await failure(a([e(403, "permission_error")]))).code).toBe("permission_denied");
    expect((await failure(a([e(402, "billing_error")]))).code).toBe("quota_exceeded");
    expect((await failure(a([e(429, "rate_limit_error")]))).code).toBe("quota_exceeded");
    expect((await failure(a([e(429, "rate_limit_error", { "retry-after": "30" })]))).code).toBe(
      "rate_limited",
    );
    expect((await failure(a([e(529, "overloaded_error"), e(529, "overloaded_error")]))).code).toBe(
      "provider_unavailable",
    );
    expect((await failure(a([e(504, "timeout_error"), e(504, "timeout_error")]))).code).toBe(
      "timeout",
    );
  });
});

describe("DP-289: Gemini adapter", () => {
  it("keeps the key in x-goog-api-key, never in the URL, and pages with pageToken", async () => {
    const { calls, fetchImpl } = mockFetch([
      json(200, {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent", "countTokens"],
            thinking: true,
          },
        ],
        nextPageToken: "p2",
      }),
      json(200, {
        models: [
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    ]);
    const models = await new GeminiAdapter(fetchImpl).listModels(GEMINI_KEY, opts());
    expect(calls.map((c) => c.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=p2",
    ]);
    for (const c of calls) {
      expect(c.url).not.toContain(GEMINI_KEY);
      expect(c.url).not.toMatch(/[?&]key=/);
      expect(c.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    }
    expect(models.map((m) => [m.modelId, m.compatible, m.capabilities.thinking])).toEqual([
      ["gemini-2.5-flash", true, true],
      ["text-embedding-004", false, null],
    ]);
  });

  it("maps an invalid key (401 or 400 API_KEY_INVALID), 403 and 429", async () => {
    const a = (answers: Parameters<typeof mockFetch>[0]) =>
      new GeminiAdapter(mockFetch(answers).fetchImpl).listModels(GEMINI_KEY, opts());
    const g = (status: number, extra: Record<string, unknown> = {}) =>
      json(status, { error: { code: status, message: PROVIDER_TEXT, ...extra } });
    expect((await failure(a([g(401)]))).code).toBe("credential_invalid");
    expect(
      (
        await failure(
          a([g(400, { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] })]),
        )
      ).code,
    ).toBe("credential_invalid");
    expect((await failure(a([g(403, { status: "PERMISSION_DENIED" })]))).code).toBe(
      "permission_denied",
    );
    expect((await failure(a([g(429, { status: "RESOURCE_EXHAUSTED" })]))).code).toBe(
      "rate_limited",
    );
  });
});

describe("DP-289: the HTTP layer", () => {
  it("reports a deadline as timeout and a dropped connection as network_error", async () => {
    const controller = new AbortController();
    const slow: FetchLike = async (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const p = new OpenAiAdapter(slow).listModels(OPENAI_KEY, { signal: controller.signal });
    controller.abort();
    expect((await failure(p)).code).toBe("timeout");
    const { fetchImpl } = mockFetch([new TypeError("fetch failed")]);
    expect((await failure(new OpenAiAdapter(fetchImpl).listModels(OPENAI_KEY, opts()))).code).toBe(
      "network_error",
    );
  });

  it("refuses an oversized or malformed answer", async () => {
    const huge = new Response("x".repeat(MAX_RESPONSE_BYTES + 10), { status: 200 });
    expect(
      (await failure(new OpenAiAdapter(mockFetch([huge]).fetchImpl).listModels(OPENAI_KEY, opts())))
        .code,
    ).toBe("bad_response");
    const notJson = new Response("<html>", { status: 200 });
    expect(
      (
        await failure(
          new OpenAiAdapter(mockFetch([notJson]).fetchImpl).listModels(OPENAI_KEY, opts()),
        )
      ).code,
    ).toBe("bad_response");
    expect(
      (
        await failure(
          new OpenAiAdapter(mockFetch([json(200, { data: "nope" })]).fetchImpl).listModels(
            OPENAI_KEY,
            opts(),
          ),
        )
      ).code,
    ).toBe("bad_response");
  });
});

describe("DP-289: keys, the fake provider and the registry", () => {
  it("checks the key format per provider and shows only a hint", () => {
    expect(keyFormatProblem("OPENAI", OPENAI_KEY)).toBeNull();
    expect(keyFormatProblem("OPENAI", ANTHROPIC_KEY)).toBe("key_format");
    expect(keyFormatProblem("ANTHROPIC", ANTHROPIC_KEY)).toBeNull();
    expect(keyFormatProblem("ANTHROPIC", OPENAI_KEY)).toBe("key_format");
    expect(keyFormatProblem("GEMINI", GEMINI_KEY)).toBeNull();
    expect(keyFormatProblem("GEMINI", `Bearer ${GEMINI_KEY}`)).toBe("key_format");
    expect(keyHint("OPENAI", OPENAI_KEY)).toBe("sk-proj-…0001");
    expect(keyHint("ANTHROPIC", ANTHROPIC_KEY)).toBe("sk-ant-…0002");
    expect(keyHint("GEMINI", GEMINI_KEY)).toBe("AIza…0003");
    for (const h of [
      keyHint("OPENAI", OPENAI_KEY),
      keyHint("ANTHROPIC", ANTHROPIC_KEY),
      keyHint("GEMINI", GEMINI_KEY),
    ]) {
      expect(h.length).toBeLessThanOrEqual(16);
    }
  });

  it("drives every outcome through the fake provider without a network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const p of ["OPENAI", "ANTHROPIC", "GEMINI"] as const) {
      const fake = new FakeAdapter(p);
      const models = await fake.listModels("sk-fake-good-key", opts());
      expect(models.filter((m) => m.compatible)).toHaveLength(1);
      expect(models.filter((m) => !m.compatible)).toHaveLength(1);
      expect(await fake.getModel("sk-fake-good-key", "nope", opts())).toBeNull();
      expect((await failure(fake.listModels("sk-fake-invalid", opts()))).code).toBe(
        "credential_invalid",
      );
      expect((await failure(fake.listModels("sk-fake-ratelimit", opts()))).code).toBe(
        "rate_limited",
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("has no adapter while the transport is off, fakes for fake, real ones for live", () => {
    expect(createAdapters("off").size).toBe(0);
    expect([...createAdapters("fake").values()].every((a) => a instanceof FakeAdapter)).toBe(true);
    const live = createAdapters("live", async () => new Response("{}"));
    expect(live.get("OPENAI")).toBeInstanceOf(OpenAiAdapter);
    expect(live.get("ANTHROPIC")).toBeInstanceOf(AnthropicAdapter);
    expect(live.get("GEMINI")).toBeInstanceOf(GeminiAdapter);
  });
});
