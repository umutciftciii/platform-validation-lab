// DP-176: the dev-only Next.js flags that keep `next dev` memory bounded stay set. Both are
// temporary workarounds for next 16.4.5 (see next.config.ts); remove this test with them (DP-115).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import nextConfig from "../next.config.ts";

describe("next.config (dev memory, DP-084 / DP-176)", () => {
  it("does not keep the React debug channel of responses no browser picks up", () => {
    assert.equal(nextConfig.experimental?.reactDebugChannel, false);
  });

  it("keeps the persistent Turbopack dev cache off (reload loop, DP-084)", () => {
    assert.equal(nextConfig.experimental?.turbopackFileSystemCacheForDev, false);
  });
});
