/**
 * DP-297 (ADR-030 D10): the encryption of the 15-minute texts — bound to kind, operation and
 * actor; a key of its own (derived), never the provider-key one; tampering and other keyrings fail
 * closed (null, never thrown); rotation keeps older versions readable.
 */
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aiCredentialAad,
  decryptSecret,
  encryptSecret,
  parseKeyring,
} from "../../../src/iam/auth/secret-box.js";
import {
  openInput,
  openResult,
  sealInput,
  sealResult,
  TRANSIENT_HKDF_SALT,
  transientAad,
  transientHkdfInfo,
  transientKeyring,
} from "../../../src/ai/transient-box.js";

/** RFC 5869 HKDF-SHA256 for one 32-byte block, written out with HMAC (independent of hkdfSync). */
function rfc5869(ikm: Buffer, salt: Buffer, info: string): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from(info, "utf8"), Buffer.from([1])]))
    .digest();
}

const k = () => randomBytes(32).toString("base64url");
/** HKDF-SHA256(0x11 × 32, TRANSIENT_HKDF_SALT, info v1) — computed independently (Python hmac, RFC 5869). */
const KAT_V1 = "d0a5ce25a88349d6747f383c1d6c2f7f9aa37e08596dbf7001f70093e33f2cdd";
/** SHA-256("dream-petroleum/ai-transient/hkdf-salt/v1"). */
const SALT_HEX = "b713b42a4135c4df446a585656b4c32978a59b4c9769dbe5d6680b559b203c35";
const ring = parseKeyring(`1:${k()}`, "DP_AI_ENC_KEYS");
const OP = "0190c0de-0000-7000-8000-000000000001";
const OP2 = "0190c0de-0000-7000-8000-000000000002";
const ACTOR = "0190c0de-0000-7000-8000-00000000000a";
const OTHER = "0190c0de-0000-7000-8000-00000000000b";
const P = {
  input: "translate canary-123",
  maxOutputTokens: 64,
  thinkingBudget: 0,
  temperature: 0.2,
};

describe("DP-297: transient box", () => {
  it("round-trips an input and a result; the ciphertext shows nothing of the text", () => {
    const c = sealInput(ring, OP, ACTOR, P);
    expect(c).not.toContain("canary");
    expect(openInput(ring, OP, ACTOR, c)).toEqual(P);
    const r = sealResult(ring, OP, ACTOR, "a draft");
    expect(openResult(ring, OP, ACTOR, r)).toBe("a draft");
  });

  it("is bound to kind, operation and actor", () => {
    const c = sealInput(ring, OP, ACTOR, P);
    expect(openInput(ring, OP2, ACTOR, c)).toBeNull();
    expect(openInput(ring, OP, OTHER, c)).toBeNull();
    expect(openResult(ring, OP, ACTOR, c)).toBeNull();
    const r = sealResult(ring, OP, ACTOR, "x");
    expect(openResult(ring, OP, OTHER, r)).toBeNull();
    expect(openInput(ring, OP, ACTOR, r)).toBeNull();
  });

  it("fails closed on tampering, garbage and another keyring", () => {
    const c = sealInput(ring, OP, ACTOR, P);
    const parts = c.split(":");
    parts[2] = Buffer.from("x".repeat(20)).toString("base64url");
    expect(openInput(ring, OP, ACTOR, parts.join(":"))).toBeNull();
    expect(openInput(ring, OP, ACTOR, "not-a-ciphertext")).toBeNull();
    expect(openInput(parseKeyring(`1:${k()}`, "DP_AI_ENC_KEYS"), OP, ACTOR, c)).toBeNull();
  });

  it("derives the transient key exactly as documented (RFC 5869, fixed salt, labelled info)", () => {
    const k1 = Buffer.alloc(32, 0x11);
    const k2 = Buffer.alloc(32, 0x22);
    const r = parseKeyring(
      `1:${k1.toString("base64url")},2:${k2.toString("base64url")}`,
      "DP_AI_ENC_KEYS",
    );
    const t = transientKeyring(r);
    expect(TRANSIENT_HKDF_SALT.toString("hex")).toBe(SALT_HEX);
    expect(TRANSIENT_HKDF_SALT.equals(Buffer.alloc(32))).toBe(false);
    expect(transientHkdfInfo(1)).toBe("dp-ai-transient|aes-256-gcm|v1|key-version:1");
    expect(t.keys.get(1)!.equals(rfc5869(k1, TRANSIENT_HKDF_SALT, transientHkdfInfo(1)))).toBe(
      true,
    );
    expect(t.keys.get(2)!.equals(rfc5869(k2, TRANSIENT_HKDF_SALT, transientHkdfInfo(2)))).toBe(
      true,
    );
    // Pinned (a change of the derivation is a format change, not a refactor).
    expect(t.keys.get(1)!.toString("hex")).toBe(KAT_V1);
    // Each version its own key; never the raw key; never the empty-salt or unlabelled derivation.
    expect(t.keys.get(1)!.equals(t.keys.get(2)!)).toBe(false);
    for (const [v, raw] of [
      [1, k1],
      [2, k2],
    ] as const) {
      const d = t.keys.get(v)!;
      expect(d.equals(raw)).toBe(false);
      expect(d.equals(rfc5869(raw, Buffer.alloc(0), transientHkdfInfo(v)))).toBe(false);
      expect(d.equals(rfc5869(raw, TRANSIENT_HKDF_SALT, "ai-credential"))).toBe(false);
    }
  });

  it("keeps the two domains apart: neither ciphertext opens in the other domain", () => {
    const cred = "0190c0de-0000-7000-8000-0000000000cc";
    const keyCt = encryptSecret(ring, Buffer.from("sk-test"), aiCredentialAad(cred, "OPENAI"));
    // A provider-key ciphertext under the transient key and AAD: refused.
    expect(openResult(ring, OP, ACTOR, keyCt)).toBeNull();
    expect(() =>
      decryptSecret(transientKeyring(ring), keyCt, aiCredentialAad(cred, "OPENAI")),
    ).toThrow();
    // A transient ciphertext under the provider key, with either AAD: refused.
    const t = sealResult(ring, OP, ACTOR, "draft");
    expect(() => decryptSecret(ring, t, transientAad("RESULT", OP, ACTOR))).toThrow();
    expect(() => decryptSecret(ring, t, aiCredentialAad(cred, "OPENAI"))).toThrow();
    expect(transientAad("RESULT", OP, ACTOR).startsWith("ai-transient|")).toBe(true);
    expect(aiCredentialAad(cred, "OPENAI").startsWith("ai-credential|")).toBe(true);
  });

  it("uses a derived key, not the provider-key one", () => {
    const derived = transientKeyring(ring);
    expect(derived.keys.get(1)!.equals(ring.keys.get(1)!)).toBe(false);
    expect(transientKeyring(ring)).toBe(derived);
    const c = sealResult(ring, OP, ACTOR, "x");
    expect(() => decryptSecret(ring, c, transientAad("RESULT", OP, ACTOR))).toThrow();
  });

  it("keeps an older key version readable after a rotation", () => {
    const old = parseKeyring(`1:${k()}`, "DP_AI_ENC_KEYS");
    const c = sealResult(old, OP, ACTOR, "before rotation");
    const rotated = parseKeyring(
      `1:${Buffer.from(old.keys.get(1)!).toString("base64url")},2:${k()}`,
      "DP_AI_ENC_KEYS",
    );
    expect(openResult(rotated, OP, ACTOR, c)).toBe("before rotation");
    expect(sealResult(rotated, OP, ACTOR, "y").startsWith("v2:")).toBe(true);
  });

  it("rejects a payload of the wrong shape", () => {
    const c = sealInput(ring, OP, ACTOR, { ...P, maxOutputTokens: 1.5 });
    expect(openInput(ring, OP, ACTOR, c)).toBeNull();
  });
});
