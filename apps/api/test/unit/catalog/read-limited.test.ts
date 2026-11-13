// PM-2/PM-5: the streaming cap of the raw upload routes (images 10 MB, documents 20 MB) for
// bodies without a declared length: reading stops at the cap with 413, nothing more is kept.
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/iam/http/api-error.js";
import { readLimited } from "../../../src/catalog/images.service.js";

function body(chunks: number, size: number): IncomingMessage {
  let n = 0;
  const r = new Readable({
    read() {
      this.push(n++ < chunks ? Buffer.alloc(size, 0x20) : null);
    },
  });
  return r as unknown as IncomingMessage;
}

describe("readLimited", () => {
  it("returns a body up to the cap", async () => {
    expect((await readLimited(body(4, 1024), 4096)).length).toBe(4096);
  });
  it("refuses a body over the cap with PAYLOAD_TOO_LARGE", async () => {
    const err = await readLimited(body(21, 1024 * 1024), 20 * 1024 * 1024).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("PAYLOAD_TOO_LARGE");
  });
});
