// PM-2: the image upload proxy (its own 10 MB route; the general proxy keeps 16 KB JSON), the
// browser-side upload checks and messages, gallery reordering and the spec editor's parsing.
import { randomBytes } from "node:crypto";
import type { SpecDefinition } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, type ProxyConfig } from "../lib/api-proxy";
import { formatBytes } from "../lib/catalog-view";
import { proxyImageUpload } from "../lib/upload-proxy";
import { moveItem, precheck, uploadMessage } from "../components/catalog/image-manager";
import { draftValue } from "../components/catalog/spec-editor";
import { splitList } from "../components/catalog/spec-definitions";

const KEY = randomBytes(32).toString("base64url");
const CONFIG: ProxyConfig = { apiUrl: "http://api.internal:3000", proxyKey: KEY, trustedHops: 1 };
const PRODUCT = "0190f2a1-0000-7000-8000-00000000000a";

function upstream(status = 201) {
  const seen: Array<{ url: string; init: RequestInit & { headers: Headers }; bytes: number }> = [];
  const fetchImpl = (async (url: string, init: RequestInit & { headers: Headers }) => {
    let bytes = 0;
    if (init.body instanceof ReadableStream) {
      const reader = init.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    }
    seen.push({ url, init, bytes });
    return new Response(JSON.stringify({ image: { id: "x" } }), {
      status,
      headers: { "content-type": "application/json", "set-cookie": "other=1" },
    });
  }) as unknown as typeof fetch;
  return { seen, deps: { fetch: fetchImpl, log: () => {} } };
}

function upload(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request(`https://admin.example/api/catalog-upload/${PRODUCT}`, {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "content-length": String(body.byteLength),
      origin: "https://admin.example",
      cookie: "__Host-dp_admin_session=abc; tracking=1",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("image upload proxy", () => {
  it("streams the image to the API's PUT route with only the allowed headers", async () => {
    const { seen, deps } = upstream();
    const res = await proxyImageUpload(
      upload(new Uint8Array(50_000), {
        "x-dp-upload-filename": "drum%20front.png",
        authorization: "x",
      }),
      PRODUCT,
      CONFIG,
      deps,
    );
    expect(res.status).toBe(201);
    const call = seen[0]!;
    expect(call.url).toBe(`${CONFIG.apiUrl}/api/v1/admin/catalog/products/${PRODUCT}/images`);
    expect(call.init.method).toBe("PUT");
    expect(call.bytes).toBe(50_000);
    const h = call.init.headers;
    expect(h.get("content-type")).toBe("image/png");
    expect(h.get("x-dp-proxy-key")).toBe(KEY);
    expect(h.get("cookie")).toBe("__Host-dp_admin_session=abc");
    expect(h.get("x-dp-upload-filename")).toBe("drum%20front.png");
    expect(h.get("x-dp-client-ip")).toBe("203.0.113.7");
    expect(h.get("authorization")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses other types, missing or oversized lengths and bad product ids without calling the API", async () => {
    const { seen, deps } = upstream();
    expect(
      (
        await proxyImageUpload(
          upload(new Uint8Array(10), { "content-type": "image/svg+xml" }),
          PRODUCT,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await proxyImageUpload(
          upload(new Uint8Array(10), { "content-type": "application/json" }),
          PRODUCT,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await proxyImageUpload(
          upload(new Uint8Array(10), { "content-length": String(10 * 1024 * 1024 + 1) }),
          PRODUCT,
          CONFIG,
          deps,
        )
      ).status,
    ).toBe(413);
    expect(
      (await proxyImageUpload(upload(new Uint8Array(10)), "../../auth", CONFIG, deps)).status,
    ).toBe(404);
    expect(seen).toHaveLength(0);
    // The general proxy keeps its JSON limit.
    expect(MAX_BODY_BYTES).toBe(16 * 1024);
  });

  it("cuts off a body longer than it declared", async () => {
    const { deps } = upstream();
    const res = await proxyImageUpload(
      upload(new Uint8Array(4096), { "content-length": "100" }),
      PRODUCT,
      CONFIG,
      deps,
    );
    expect(res.status).toBe(413);
  });

  it("drops a file name header with unexpected characters", async () => {
    const { seen, deps } = upstream();
    await proxyImageUpload(
      upload(new Uint8Array(10), { "x-dp-upload-filename": "a<b>.png" }),
      PRODUCT,
      CONFIG,
      deps,
    );
    expect(seen.at(-1)!.init.headers.get("x-dp-upload-filename")).toBeNull();
  });
});

describe("upload checks and messages", () => {
  it("prechecks type and size in the browser", () => {
    expect(precheck({ type: "image/png", size: 1000 })).toBeNull();
    expect(precheck({ type: "image/svg+xml", size: 1000 })).toMatch(/JPEG, PNG or WebP/);
    expect(precheck({ type: "image/jpeg", size: 0 })).toMatch(/empty/);
    expect(precheck({ type: "image/webp", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });

  it("explains API refusals", () => {
    const err = (rule: string, code = "VALIDATION_FAILED") => ({
      error: { code, message: "x", requestId: "r", details: [{ path: "file", rule }] },
    });
    expect(uploadMessage(400, err("too_small"))).toMatch(/800×600/);
    expect(uploadMessage(400, err("too_many_pixels"))).toMatch(/25 megapixels/);
    expect(uploadMessage(400, err("corrupt"))).toMatch(/damaged/);
    expect(uploadMessage(415, err("type_mismatch", "UNSUPPORTED_MEDIA_TYPE"))).toMatch(
      /does not match/,
    );
    expect(uploadMessage(413, null)).toMatch(/10 MB/);
    expect(
      uploadMessage(503, {
        error: { code: "STORAGE_UNAVAILABLE", message: "x", requestId: "r", details: [] },
      }),
    ).toMatch(/storage/i);
    expect(uploadMessage(0, null)).toMatch(/interrupted/);
  });

  it("moves gallery items one step and formats sizes", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("spec editor parsing", () => {
  const def = (dataType: SpecDefinition["dataType"]) => ({ dataType }) as SpecDefinition;
  const draft = {
    on: true,
    basis: "SPECIFICATION" as const,
    number: "",
    min: "",
    max: "",
    minExclusive: false,
    maxExclusive: false,
    text: "",
    bool: "" as const,
    unit: "",
    testMethod: "",
  };
  it("turns typed strings into typed values", () => {
    expect(draftValue(def("NUMBER"), { ...draft, number: "5,85" })).toEqual({
      type: "NUMBER",
      number: 5.85,
    });
    expect(draftValue(def("NUMBER"), { ...draft, number: "abc" })).toBe("not_a_number");
    expect(draftValue(def("NUMBER"), draft)).toBe("empty");
    expect(draftValue(def("RANGE"), { ...draft, min: "-45", max: "-36" })).toEqual({
      type: "RANGE",
      min: -45,
      max: -36,
      minExclusive: false,
      maxExclusive: false,
    });
    // DP-156: one-sided and open-ended limits; both ends empty is still "empty".
    expect(draftValue(def("RANGE"), { ...draft, min: "200" })).toEqual({
      type: "RANGE",
      min: 200,
      max: null,
      minExclusive: false,
      maxExclusive: false,
    });
    expect(
      draftValue(def("RANGE"), { ...draft, min: "3,8", max: "4.5", maxExclusive: true }),
    ).toEqual({ type: "RANGE", min: 3.8, max: 4.5, minExclusive: false, maxExclusive: true });
    // an open flag without its end is dropped, not sent
    expect(draftValue(def("RANGE"), { ...draft, max: "1800", minExclusive: true })).toEqual({
      type: "RANGE",
      min: null,
      max: 1800,
      minExclusive: false,
      maxExclusive: false,
    });
    expect(draftValue(def("RANGE"), draft)).toBe("empty");
    expect(draftValue(def("RANGE"), { ...draft, max: "x" })).toBe("not_a_number");
    expect(draftValue(def("TEXT"), { ...draft, text: "  Clear " })).toEqual({
      type: "TEXT",
      text: "Clear",
    });
    expect(draftValue(def("BOOLEAN"), { ...draft, bool: "false" as never })).toEqual({
      type: "BOOLEAN",
      boolean: false,
    });
  });
  it("splits comma lists", () => {
    expect(splitList(" mm²/s, cSt ,,")).toEqual(["mm²/s", "cSt"]);
  });
});
