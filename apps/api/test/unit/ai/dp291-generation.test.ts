/**
 * DP-291 (ADR-030 D4, D6, D8): text generation of the three adapters against an isolated mock
 * `fetch` (no network, no paid call) — request shape, the key only in a header, usage normalised
 * to the common model (cache reads/writes, reasoning/thinking), the end of the answer, error
 * mapping, NO retry of a paid call; the fake provider; the personal-data input policy; the tasks.
 */
import { describe, expect, it } from "vitest";
import {
  AnthropicAdapter,
  ANTHROPIC_VERSION,
  anthropicGeneration,
} from "../../../src/ai/providers/anthropic.js";
import { FakeAdapter } from "../../../src/ai/providers/fake.js";
import { GeminiAdapter, geminiGeneration } from "../../../src/ai/providers/gemini.js";
import type { FetchLike } from "../../../src/ai/providers/http.js";
import { OpenAiAdapter, openAiGeneration } from "../../../src/ai/providers/openai.js";
import {
  isUncertain,
  ProviderCallError,
  type GenerateRequest,
} from "../../../src/ai/providers/types.js";
import { personalDataIn } from "../../../src/ai/engine/input-policy.js";
import { AI_TASKS } from "../../../src/ai/tasks/registry.js";

const OPENAI_KEY = ["sk", "proj", "TESTKEY" + "abcdefghijklmnopqrstuv" + "0101"].join("-");
const ANTHROPIC_KEY = ["sk", "ant", "api03", "TESTKEY" + "abcdefghijklmnop" + "0102"].join("-");
const GEMINI_KEY = ["AI", "za", "SyTESTKEY", "abcdefghijklmnopqrstuvw", "0103"].join("");
const PROVIDER_TEXT = "PROVIDER-SECRET-TEXT do not leak";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  redirect: RequestInit["redirect"];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockFetch(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: String(init.method),
      headers: { ...((init.headers ?? {}) as Record<string, string>) },
      body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
      redirect: init.redirect,
    });
    const next = answers.shift();
    if (!next) throw new Error("no answer queued");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

const REQ: GenerateRequest = {
  model: "model-x",
  system: "Reply with pong.",
  input: "ping",
  maxOutputTokens: 64,
  thinkingBudget: 0,
  temperature: 0.2,
};
const opts = () => ({ signal: AbortSignal.timeout(5_000) });

async function failure(p: Promise<unknown>): Promise<ProviderCallError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderCallError);
    expect(String((e as Error).message)).not.toContain(PROVIDER_TEXT);
    return e as ProviderCallError;
  }
  throw new Error("expected a failure");
}

const OPENAI_OK = {
  id: "resp_1",
  object: "response",
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "message",
      content: [
        { type: "output_text", text: "po" },
        { type: "output_text", text: "ng" },
      ],
    },
  ],
  usage: {
    input_tokens: 12_000,
    input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 7_000 },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 200 },
    total_tokens: 12_300,
  },
};
const ANTHROPIC_OK = {
  id: "msg_1",
  type: "message",
  content: [{ type: "text", text: "pong" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 50,
    cache_read_input_tokens: 1_000,
    cache_creation_input_tokens: 2_000,
    output_tokens: 40,
    output_tokens_details: { thinking_tokens: 10 },
  },
};
const GEMINI_OK = {
  responseId: "gem_1",
  candidates: [
    {
      content: { parts: [{ text: "thinking…", thought: true }, { text: "pong" }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 900,
    cachedContentTokenCount: 600,
    candidatesTokenCount: 5,
    thoughtsTokenCount: 120,
    totalTokenCount: 1_025,
  },
};

describe("DP-291: OpenAI Responses API", () => {
  it("sends one POST with instructions, input, the output cap, store:false and no tools; key in the header only", async () => {
    const { calls, fetchImpl } = mockFetch([json(200, OPENAI_OK)]);
    const r = await new OpenAiAdapter(fetchImpl).generate(OPENAI_KEY, REQ, {
      ...opts(),
      projectRef: "proj_1",
    });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c).toMatchObject({
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      redirect: "error",
    });
    expect(c.url).not.toContain(OPENAI_KEY);
    expect(c.headers["authorization"]).toBe(`Bearer ${OPENAI_KEY}`);
    expect(c.headers["openai-project"]).toBe("proj_1");
    expect(c.body).toEqual({
      model: "model-x",
      instructions: "Reply with pong.",
      input: "ping",
      max_output_tokens: 64,
      store: false,
      tool_choice: "none",
      temperature: 0.2,
    });
    expect(r).toEqual({
      text: "pong",
      // input_tokens includes cache reads and writes; output includes reasoning.
      usage: {
        inputTokens: 1_000,
        cachedReadTokens: 4_000,
        cacheWriteTokens: 7_000,
        outputTokens: 300,
        reasoningTokens: 200,
      },
      finish: "complete",
      providerRequestId: "resp_1",
    });
  });

  it("raises the cap to the API's minimum and maps incomplete answers", () => {
    expect(
      openAiGeneration({
        ...OPENAI_OK,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
    ).toMatchObject({ text: "", finish: "max_tokens" });
    expect(
      openAiGeneration({
        ...OPENAI_OK,
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      }).finish,
    ).toBe("refused");
    expect(openAiGeneration({ ...OPENAI_OK, status: "failed" }).finish).toBe("incomplete");
    // Missing or odd usage never becomes negative or fractional.
    expect(
      openAiGeneration({ status: "completed", usage: { input_tokens: -5, output_tokens: 2.7 } })
        .usage,
    ).toEqual({
      inputTokens: 0,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 2,
      reasoningTokens: 0,
    });
  });
});

describe("DP-291: Anthropic Messages API", () => {
  it("sends system + one user message + max_tokens, never a temperature (removed in 2026-10-21)", async () => {
    const { calls, fetchImpl } = mockFetch([json(200, ANTHROPIC_OK)]);
    const r = await new AnthropicAdapter(fetchImpl).generate(ANTHROPIC_KEY, REQ, opts());
    const c = calls[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.headers["authorization"]).toBe(`Bearer ${ANTHROPIC_KEY}`);
    expect(c.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(c.body).toEqual({
      model: "model-x",
      system: "Reply with pong.",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 64,
    });
    expect(r).toEqual({
      text: "pong",
      usage: {
        inputTokens: 50,
        cachedReadTokens: 1_000,
        cacheWriteTokens: 2_000,
        outputTokens: 40,
        reasoningTokens: 10,
      },
      finish: "complete",
      providerRequestId: "msg_1",
    });
  });

  it("maps stop reasons", () => {
    expect(anthropicGeneration({ ...ANTHROPIC_OK, stop_reason: "max_tokens" }).finish).toBe(
      "max_tokens",
    );
    expect(anthropicGeneration({ ...ANTHROPIC_OK, stop_reason: "refusal" }).finish).toBe("refused");
    expect(anthropicGeneration({ ...ANTHROPIC_OK, stop_reason: "pause_turn" }).finish).toBe(
      "incomplete",
    );
  });
});

describe("DP-291: Gemini generateContent", () => {
  it("sends systemInstruction, contents and generationConfig; thinking budget only when set; key in the header", async () => {
    const { calls, fetchImpl } = mockFetch([json(200, GEMINI_OK), json(200, GEMINI_OK)]);
    const a = new GeminiAdapter(fetchImpl);
    const r = await a.generate(GEMINI_KEY, REQ, opts());
    await a.generate(GEMINI_KEY, { ...REQ, thinkingBudget: 512, temperature: null }, opts());
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/model-x:generateContent",
    );
    expect(calls[0]!.url).not.toContain(GEMINI_KEY);
    expect(calls[0]!.headers["x-goog-api-key"]).toBe(GEMINI_KEY);
    expect(calls[0]!.body).toEqual({
      systemInstruction: { parts: [{ text: "Reply with pong." }] },
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 64, temperature: 0.2 },
    });
    expect(calls[1]!.body["generationConfig"]).toEqual({
      maxOutputTokens: 64,
      thinkingConfig: { thinkingBudget: 512 },
    });
    expect(r).toEqual({
      text: "pong",
      // promptTokenCount includes the cache; thoughts are billed as output on top of candidates.
      usage: {
        inputTokens: 300,
        cachedReadTokens: 600,
        cacheWriteTokens: 0,
        outputTokens: 125,
        reasoningTokens: 120,
      },
      finish: "complete",
      providerRequestId: "gem_1",
    });
  });

  it("maps finish and block reasons", () => {
    const with_ = (finishReason: string) =>
      geminiGeneration({ ...GEMINI_OK, candidates: [{ ...GEMINI_OK.candidates[0], finishReason }] })
        .finish;
    expect(with_("MAX_TOKENS")).toBe("max_tokens");
    expect(with_("SAFETY")).toBe("refused");
    expect(with_("RECITATION")).toBe("refused");
    expect(with_("OTHER")).toBe("incomplete");
    expect(
      geminiGeneration({
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 10 },
      }),
    ).toMatchObject({
      text: "",
      finish: "refused",
      usage: { inputTokens: 10, outputTokens: 0 },
    });
  });
});

describe("DP-291: a paid call is never retried", () => {
  const adapters = (f: FetchLike) =>
    [
      [new OpenAiAdapter(f), OPENAI_KEY],
      [new AnthropicAdapter(f), ANTHROPIC_KEY],
      [new GeminiAdapter(f), GEMINI_KEY],
    ] as const;

  it("maps refusals before work to definite codes after exactly one request", async () => {
    for (const [status, body, code] of [
      [
        401,
        { error: { type: "authentication_error", message: PROVIDER_TEXT } },
        "credential_invalid",
      ],
      [500, { error: { type: "api_error", message: PROVIDER_TEXT } }, "provider_unavailable"],
      [503, { error: { message: PROVIDER_TEXT } }, "provider_unavailable"],
    ] as const) {
      for (let i = 0; i < 3; i++) {
        const { calls, fetchImpl } = mockFetch([json(status, body), json(200, {})]);
        const [adapter, key] = adapters(fetchImpl)[i]!;
        const e = await failure(adapter.generate(key, REQ, opts()));
        expect(e.code, `${adapter.provider} ${status}`).toBe(code);
        expect(isUncertain(e.code)).toBe(false);
        expect(calls).toHaveLength(1);
      }
    }
    // 429 with a short Retry-After: still one request (the list endpoints would retry).
    const { calls, fetchImpl } = mockFetch([
      json(429, { error: { type: "rate_limit_error" } }, { "retry-after": "1" }),
      json(200, ANTHROPIC_OK),
    ]);
    expect(
      (await failure(new AnthropicAdapter(fetchImpl).generate(ANTHROPIC_KEY, REQ, opts()))).code,
    ).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  it("turns a deadline, a lost connection and an unreadable answer into UNCERTAIN codes", async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const controller = new AbortController();
    const p = new OpenAiAdapter(slow).generate(OPENAI_KEY, REQ, { signal: controller.signal });
    controller.abort();
    expect((await failure(p)).code).toBe("timeout");
    const lost = mockFetch([new TypeError("socket hang up")]);
    expect(
      (await failure(new GeminiAdapter(lost.fetchImpl).generate(GEMINI_KEY, REQ, opts()))).code,
    ).toBe("network_error");
    const garbled = mockFetch([new Response("<html>", { status: 200 })]);
    const e = await failure(
      new AnthropicAdapter(garbled.fetchImpl).generate(ANTHROPIC_KEY, REQ, opts()),
    );
    expect(e.code).toBe("bad_response");
    for (const code of ["timeout", "network_error", "bad_response"] as const)
      expect(isUncertain(code)).toBe(true);
  });
});

describe("DP-291: the fake provider", () => {
  const fake = new FakeAdapter("OPENAI");
  const key = "fake-key-0123456789abcdef";

  it("answers pong with a deterministic usage and counts its calls", async () => {
    const before = FakeAdapter.generateCalls;
    const r = await fake.generate(key, REQ, opts());
    expect(r).toMatchObject({
      text: "pong",
      finish: "complete",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect(FakeAdapter.generateCalls).toBe(before + 1);
  });

  it("follows the test directives of the input", async () => {
    const run = (input: string, signal = AbortSignal.timeout(5_000)) =>
      fake.generate(key, { ...REQ, input }, { signal });
    expect((await failure(run("[fake:error=provider_unavailable]"))).code).toBe(
      "provider_unavailable",
    );
    expect((await run("[fake:refuse]")).finish).toBe("refused");
    expect((await run("[fake:max_tokens]")).usage.outputTokens).toBe(64);
    expect((await run("[fake:overrun]")).usage.outputTokens).toBe(128);
    const c = new AbortController();
    const slow = run("[fake:delay=5000]", c.signal);
    setTimeout(() => c.abort(), 20);
    expect((await failure(slow)).code).toBe("timeout");
    expect((await failure(fake.generate("key-invalid-000000", REQ, opts()))).code).toBe(
      "credential_invalid",
    );
  });
});

describe("DP-291: no personal data to a provider", () => {
  it("rejects e-mail addresses, phone numbers, IBANs and card numbers", () => {
    expect(personalDataIn("mail jan.jansen@example.nl please")).toBe("email");
    expect(personalDataIn("bel +31 6 1234 5678")).toBe("phone");
    expect(personalDataIn("bel 0031612345678")).toBe("phone");
    expect(personalDataIn("bel 06-12345678")).toBe("phone");
    expect(personalDataIn("tel 020 123 4567")).toBe("phone");
    expect(personalDataIn("IBAN NL91 ABNA 0417 1643 00")).toBe("iban");
    expect(personalDataIn("card 4111 1111 1111 1111")).toBe("payment_card");
  });

  it("lets product and content text through (dates, prices, viscosity grades, article numbers)", () => {
    for (const text of [
      "ping",
      "Released 2026-11-26 at 12:00, version 1.2.3",
      "Price EUR 1.299,95 per 208 L drum",
      "SAE 5W-30, ACEA C3, API SP; flash point 230 °C",
      "Article 4006 and 12345678 units",
      "NL91 is not an IBAN on its own",
    ]) {
      expect(personalDataIn(text), text).toBeNull();
    }
  });
});

describe("DP-291: tasks", () => {
  it("offers the diagnostic ping only; every answer is checked", () => {
    expect(
      Object.values(AI_TASKS)
        .filter((t) => t.available)
        .map((t) => t.task),
    ).toEqual(["DIAGNOSTIC_PING"]);
    const ping = AI_TASKS.DIAGNOSTIC_PING;
    expect(ping.checkOutput("  pong \n")).toBe("pong");
    expect(ping.checkOutput("   ")).toBeNull();
    expect(ping.checkOutput("x".repeat(201))).toBeNull();
    expect(AI_TASKS.TRANSLATION.checkOutput("anything")).toBeNull();
  });
});
