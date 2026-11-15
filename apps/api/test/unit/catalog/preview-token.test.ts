// DP-173: signed catalogue preview links — bound to session, user, site and a short expiry; any
// change to the token, another site, an expired or over-long link is refused.
import { randomBytes } from "node:crypto";
import { CATALOG_PREVIEW_TTL_MS, CatalogPreviewTokenSchema } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import {
  issueCatalogPreviewToken,
  verifyCatalogPreviewToken,
} from "../../../src/catalog/preview-token.js";

const KEY = randomBytes(32);
const SID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const UID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("catalogue preview token", () => {
  const { token, expiresAt } = issueCatalogPreviewToken(
    KEY,
    { sessionId: SID, userId: UID, siteKey: "BV" },
    NOW,
  );

  it("verifies on its site until it expires, and carries no session token", () => {
    expect(CatalogPreviewTokenSchema.safeParse(token).success).toBe(true);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(CATALOG_PREVIEW_TTL_MS);
    expect(verifyCatalogPreviewToken(KEY, token, "BV", NOW)).toMatchObject({
      sessionId: SID,
      userId: UID,
      siteKey: "BV",
    });
    expect(
      verifyCatalogPreviewToken(KEY, token, "BV", new Date(expiresAt.getTime() - 1)),
    ).not.toBeNull();
    expect(verifyCatalogPreviewToken(KEY, token, "BV", expiresAt)).toBeNull();
  });

  it("refuses another site, another key and any changed part", () => {
    expect(verifyCatalogPreviewToken(KEY, token, "CORPORATE", NOW)).toBeNull();
    expect(verifyCatalogPreviewToken(randomBytes(32), token, "BV", NOW)).toBeNull();
    const parts = token.split(".");
    const swapped = [parts[0], parts[2], parts[1], ...parts.slice(3)].join(".");
    expect(verifyCatalogPreviewToken(KEY, swapped, "BV", NOW)).toBeNull();
    const later = [...parts.slice(0, 4), String(Number(parts[4]) + 60_000), parts[5]].join(".");
    expect(verifyCatalogPreviewToken(KEY, later, "BV", NOW)).toBeNull();
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyCatalogPreviewToken(KEY, flipped, "BV", NOW)).toBeNull();
    expect(verifyCatalogPreviewToken(KEY, "v1.not-a-token", "BV", NOW)).toBeNull();
  });

  it("never issues or accepts a link longer than the preview lifetime", () => {
    const long = issueCatalogPreviewToken(
      KEY,
      { sessionId: SID, userId: UID, siteKey: "BV" },
      NOW,
      24 * 3_600_000,
    );
    expect(long.expiresAt.getTime() - NOW.getTime()).toBe(CATALOG_PREVIEW_TTL_MS);
    // a link signed for the future (clock skew or forgery with the key) is refused past the TTL
    const future = issueCatalogPreviewToken(
      KEY,
      { sessionId: SID, userId: UID, siteKey: "BV" },
      new Date(NOW.getTime() + 60 * 60_000),
    );
    expect(verifyCatalogPreviewToken(KEY, future.token, "BV", NOW)).toBeNull();
  });
});
