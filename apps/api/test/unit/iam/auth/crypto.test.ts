// AC-CR-1 (F1-002 Group 1): Argon2id parameters, re-hash and semaphore; TOTP RFC 6238 vectors;
// AES-256-GCM; HMAC; tokens and recovery codes; NT-T6, NT-L3 (unit level), NT-W1, NT-W2.
import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import {
  ARGON2_PARAMS,
  MAX_CONCURRENT_HASHES,
  dummyVerify,
  foldIdentity,
  hashPassword,
  hashSemaphore,
  identityParts,
  normalizePassword,
  passwordPolicyProblems,
  verifyPassword,
} from "../../../../src/iam/auth/password.js";
import { Semaphore } from "../../../../src/iam/auth/semaphore.js";
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from "../../../../src/iam/auth/totp.js";
import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  mfaAad,
  needsReencryption,
  parseKeyring,
} from "../../../../src/iam/auth/secret-box.js";
import { digestEquals, hmacHex } from "../../../../src/iam/auth/hmac.js";
import {
  CROCKFORD,
  formatRecoveryCode,
  generateRecoveryCodes,
  generateToken,
  hashRecoveryCode,
  hashToken,
  isWellFormedToken,
  normalizeRecoveryCode,
} from "../../../../src/iam/auth/tokens.js";
import {
  AuthSecretsError,
  loadAuthSecrets,
  parseHmacKey,
} from "../../../../src/iam/auth/secrets.js";
import { ipPrefix } from "../../../../src/iam/auth/ip-prefix.js";

const key32 = () => randomBytes(32).toString("base64url");

describe("Argon2id password hashing", () => {
  it("uses Argon2id with m = 19 MiB, t = 2, p = 1 and verifies the NFKC form", async () => {
    expect(ARGON2_PARAMS).toEqual({
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const hash = await hashPassword("ｃｏｒｒｅｃｔ-ｈｏｒｓｅ-42"); // full-width forms
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,(t=2,p=1|p=1,t=2)\$/);
    expect(await verifyPassword(hash, "correct-horse-42")).toEqual({
      ok: true,
      needsRehash: false,
    });
    expect(await verifyPassword(hash, "correct-horse-43")).toEqual({
      ok: false,
      needsRehash: false,
    });
    expect(normalizePassword("ﬁ")).toBe("fi");
  });

  it("flags hashes with other parameters for re-hashing after a successful login", async () => {
    const weak = await argon2.hash("old-password-123", {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    expect(await verifyPassword(weak, "old-password-123")).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword(weak, "wrong")).toEqual({ ok: false, needsRehash: false });
  });

  it("denies non-Argon2id and malformed hashes", async () => {
    const argon2i = await argon2.hash("x", { type: argon2.argon2i });
    expect((await verifyPassword(argon2i, "x")).ok).toBe(false);
    expect((await verifyPassword("$argon2id$garbage", "x")).ok).toBe(false);
    expect(await dummyVerify("anything")).toBe(false);
  });

  it("NT-T6: runs at most four hashes at once under 50 concurrent logins", async () => {
    expect(MAX_CONCURRENT_HASHES).toBe(4);
    hashSemaphore.maxObserved = 0;
    const hash = await hashPassword("concurrency-test-pw");
    hashSemaphore.maxObserved = 0;
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        verifyPassword(hash, i % 2 ? "concurrency-test-pw" : "x"),
      ),
    );
    expect(hashSemaphore.maxObserved).toBeLessThanOrEqual(4);
    expect(hashSemaphore.maxObserved).toBeGreaterThan(1);
    expect(hashSemaphore.inUse).toBe(0);
  }, 60_000);

  it("serves semaphore waiters in order and releases on failure", async () => {
    const s = new Semaphore(1);
    const order: number[] = [];
    await Promise.allSettled([
      s.run(async () => {
        order.push(1);
        throw new Error("boom");
      }),
      s.run(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
    expect(s.inUse).toBe(0);
    expect(() => new Semaphore(0)).toThrow();
  });
});

describe("password policy (A5, A11)", () => {
  const staff = {
    kind: "STAFF" as const,
    hasMfa: true,
    email: "ayse.yilmaz@example.com",
    displayName: "Ayşe Yılmaz",
  };
  it("NT-W1: staff need 12 characters, customers 15 without MFA and 12 with it, at most 128", () => {
    expect(passwordPolicyProblems("Kq7#vLw2!pZm", staff)).toEqual([]); // 12
    expect(passwordPolicyProblems("Kq7#vLw2!pZ", staff)).toEqual(["too_short"]); // 11
    expect(passwordPolicyProblems("Kq7#vLw2!pZ", { ...staff, hasMfa: false })).toEqual([
      "too_short",
    ]);
    const customer = { kind: "CUSTOMER" as const, hasMfa: false };
    expect(passwordPolicyProblems("Kq7#vLw2!pZm4Rt", customer)).toEqual([]); // 15
    expect(passwordPolicyProblems("Kq7#vLw2!pZm4R", customer)).toEqual(["too_short"]); // 14
    expect(passwordPolicyProblems("Kq7#vLw2!pZm", { ...customer, hasMfa: true })).toEqual([]);
    expect(passwordPolicyProblems("a".repeat(120) + "Kq7#vLw2!", customer)).toEqual(["too_long"]);
    // Length counts code points after NFKC, not UTF-16 units.
    expect(passwordPolicyProblems("🔐".repeat(12), staff)).toEqual([]);
  });

  it("NT-W2: refuses breached passwords and the e-mail local part or display name", () => {
    expect(passwordPolicyProblems("Password1234", staff)).toContain("breached");
    expect(passwordPolicyProblems("PASSWORD1234", staff)).toContain("breached");
    expect(passwordPolicyProblems("xx-ayse.yilmaz-2026", staff)).toContain("contains_identity");
    expect(passwordPolicyProblems("Yılmaz!Secure#77", staff)).toContain("contains_identity");
    expect(passwordPolicyProblems("Kq7#vLw2!pZm", staff)).toEqual([]);
  });

  describe("NT-W2: identity check folds Unicode, accents and Turkish i", () => {
    const ezgi = {
      kind: "STAFF" as const,
      hasMfa: true,
      email: "ezgi.ciftci@example.com",
      displayName: "Ezgi Çiftci",
    };
    const identity = (password: string, ctx: Parameters<typeof passwordPolicyProblems>[1] = ezgi) =>
      passwordPolicyProblems(password, ctx).includes("contains_identity");

    it("folds case, combining marks, compatibility forms and dotted/dotless i", () => {
      expect(foldIdentity("ÇİFTÇİ")).toBe("ciftci");
      expect(foldIdentity("Çiftci")).toBe("ciftci");
      expect(foldIdentity("CIFTCI")).toBe("ciftci");
      expect(foldIdentity("çıftçı")).toBe("ciftci");
      expect(foldIdentity("ŞĞÜÖÇİ şğüöçı")).toBe("sguoci sguoci");
      expect(foldIdentity("çiftci")).toBe("ciftci"); // decomposed input
      expect(foldIdentity("ＥＺＧＩ")).toBe("ezgi"); // full-width (NFKD compatibility)
    });

    it("derives ezgi, ciftci and ezgiciftci from the e-mail and the display name", () => {
      expect(identityParts(ezgi).sort()).toEqual(["ciftci", "ezgi", "ezgiciftci"]);
    });

    it.each([
      ["ezgi", "Mavi!ezgi#2026x"],
      ["ciftci", "ciftci-mavi-dalga-77"],
      ["çiftci", "Kq7#çiftci!pZm"],
      ["ÇİFTÇİ", "ÇİFTÇİ-mavi-dalga"],
      ["CIFTCI", "CIFTCI-mavi-dalga"],
      ["ezgi.ciftci", "ezgi.ciftci-2026!"],
      ["ezgiciftci", "x9ezgiciftci!Q"],
      ["Ezgi_Çiftci", "Ezgi_Çiftci#2026"],
      ["e.z.g.i", "e.z.g.i-mavi-dalga"],
      ["EZGI (full-width)", "ＥＺＧＩ-mavi-dalga"],
    ])("refuses a password containing %s", (_label, password) => {
      expect(identity(password)).toBe(true);
    });

    it("does not refuse unrelated passwords", () => {
      expect(identity("Kq7#vLw2!pZm")).toBe(false);
      expect(identity("mavi-dalga-sahil-77")).toBe(false);
    });

    it("ignores digits and separators inside the password (letters are compared joined)", () => {
      expect(identity("e7z7g7i-mavi-dalga")).toBe(true);
    });

    it("ignores short and generic parts to avoid false positives", () => {
      const ali = { ...ezgi, email: "ali.can@example.com", displayName: "Ali Can" };
      expect(identityParts(ali)).toEqual(["alican"]);
      expect(identity("Quality-Canvas-77", ali)).toBe(false); // "ali", "can" inside words
      expect(identity("AliCan#2026!xyz", ali)).toBe(true);
      const info = { ...ezgi, email: "info@example.com", displayName: null };
      expect(identityParts(info)).toEqual([]);
      expect(identity("my-info-desk-2026", info)).toBe(false);
      const admin = { ...ezgi, email: "first.admin@staff.dp.test", displayName: null };
      expect(identityParts(admin).sort()).toEqual(["first", "firstadmin"]);
      expect(identity("admin-desk-lamp-77", admin)).toBe(false);
      const digits = { ...ezgi, email: "john1985@example.com", displayName: null };
      expect(identityParts(digits)).toEqual(["john"]);
      expect(identity("river-1985-stone", digits)).toBe(false);
    });

    it("keeps the other rules unchanged", () => {
      expect(passwordPolicyProblems("ciftci", ezgi)).toEqual(["too_short", "contains_identity"]);
      expect(passwordPolicyProblems("Password1234", ezgi)).toEqual(["breached"]);
    });
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B, 8 digits, SHA-1 / SHA-256 / SHA-512 seeds.
  const seeds = {
    sha1: Buffer.from("12345678901234567890"),
    sha256: Buffer.from("12345678901234567890123456789012"),
    sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  it("matches the RFC 6238 Appendix B vectors", () => {
    for (const [t, s1, s256, s512] of vectors) {
      const step = totpStep(new Date(t * 1000));
      expect(hotp(seeds.sha1, step, 8, "sha1"), `t=${t}`).toBe(s1);
      expect(hotp(seeds.sha256, step, 8, "sha256"), `t=${t}`).toBe(s256);
      expect(hotp(seeds.sha512, step, 8, "sha512"), `t=${t}`).toBe(s512);
      expect(totpCode(seeds.sha1, new Date(t * 1000))).toBe(s1.slice(2));
    }
  });

  it("accepts ±1 step, returns the step, and refuses replays and older steps", () => {
    const now = new Date(1_800_000_000_000);
    const step = totpStep(now);
    const code = totpCode(seeds.sha1, now);
    expect(verifyTotp(seeds.sha1, code, now)).toBe(step);
    expect(verifyTotp(seeds.sha1, code, new Date(now.getTime() + 30_000))).toBe(step);
    expect(verifyTotp(seeds.sha1, code, new Date(now.getTime() - 30_000))).toBe(step);
    expect(verifyTotp(seeds.sha1, code, new Date(now.getTime() + 61_000))).toBeNull();
    expect(verifyTotp(seeds.sha1, code, now, step)).toBeNull(); // same step again (T16)
    expect(verifyTotp(seeds.sha1, code, now, step - 1n)).toBe(step);
    expect(verifyTotp(seeds.sha1, "12345", now)).toBeNull();
    expect(verifyTotp(seeds.sha1, "abcdef", now)).toBeNull();
  });

  it("round-trips base32 and builds an otpauth URI without sending the secret anywhere", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezdgnbvgy3tqojqgezdgnbvgy3tqojq").equals(secret)).toBe(true);
    const uri = otpauthUri(secret, "admin@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Dream%20Petroleum%3Aadmin%40example\.com\?/);
    expect(new URL(uri).searchParams.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(new URL(uri).searchParams.get("digits")).toBe("6");
  });
});

describe("AES-256-GCM secret box", () => {
  it("encrypts with the newest key, binds the row (AAD) and keeps old versions readable", () => {
    const ring1 = parseKeyring(`1:${key32()}`);
    const secret = randomBytes(20);
    const aad = mfaAad("user-a", "factor-1");
    const v1 = encryptSecret(ring1, secret, aad);
    expect(v1).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    // NT-L3: the stored form contains neither the raw nor the base32 secret.
    expect(v1).not.toContain(base32Encode(secret));
    expect(v1).not.toContain(secret.toString("base64url"));
    expect(decryptSecret(ring1, v1, aad).equals(secret)).toBe(true);
    expect(() => decryptSecret(ring1, v1, mfaAad("user-b", "factor-1"))).toThrow(SecretBoxError);

    const ring2 = parseKeyring(
      `${[...ring1.keys].map(([v, k]) => `${v}:${k.toString("base64url")}`)},2:${key32()}`,
    );
    expect(ring2.current).toBe(2);
    expect(decryptSecret(ring2, v1, aad).equals(secret)).toBe(true);
    expect(needsReencryption(ring2, v1)).toBe(true);
    const v2 = encryptSecret(ring2, secret, aad);
    expect(v2.startsWith("v2:")).toBe(true);
    expect(needsReencryption(ring2, v2)).toBe(false);
    // Tampering is detected.
    const parts = v2.split(":");
    const ct = Buffer.from(parts[2] as string, "base64url");
    ct[0] = (ct[0] as number) ^ 1;
    parts[2] = ct.toString("base64url");
    expect(() => decryptSecret(ring2, parts.join(":"), aad)).toThrow(SecretBoxError);
    expect(() => decryptSecret(ring2, "v9:aa:bb:cc", aad)).toThrow(/unknown key version|malformed/);
  });

  it("refuses missing, short, duplicate and repeated keys", () => {
    const k = key32();
    expect(() => parseKeyring(undefined)).toThrow(/not set/);
    expect(() => parseKeyring(`1:${randomBytes(16).toString("base64url")}`)).toThrow(/32 bytes/);
    expect(() => parseKeyring(`1:${k},1:${key32()}`)).toThrow(/duplicate version/);
    expect(() => parseKeyring(`1:${k},2:${k}`)).toThrow(/distinct/);
    expect(() => parseKeyring(`0:${k}`)).toThrow(/positive/);
    expect(() => parseKeyring(`one:${k}`)).toThrow(/<version>/);
  });
});

describe("HMAC, tokens and recovery codes", () => {
  const hmacKey = randomBytes(32);
  it("separates HMAC domains and compares digests in constant time", () => {
    const a = hmacHex(hmacKey, "throttle_account", "x@example.com");
    const b = hmacHex(hmacKey, "throttle_ip", "x@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(digestEquals(a, a)).toBe(true);
    expect(digestEquals(a, b)).toBe(false);
    expect(digestEquals(a, a.slice(0, 32))).toBe(false);
  });

  it("generates 256-bit tokens and stores only their SHA-256", () => {
    const t = generateToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashToken(t)).toBe(createHash("sha256").update(t).digest("hex"));
    expect(new Set(Array.from({ length: 100 }, generateToken)).size).toBe(100);
    expect(isWellFormedToken("short")).toBe(false);
  });

  it("generates ten unique Crockford codes, normalises input and hashes with HMAC (NT-L3)", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toHaveLength(10);
      for (const ch of c) expect(CROCKFORD).toContain(ch);
    }
    const code = codes[0] as string;
    expect(normalizeRecoveryCode(formatRecoveryCode(code).toLowerCase())).toBe(code);
    expect(normalizeRecoveryCode("ABCDE-FGHIL")).toBe("ABCDEFGH11");
    expect(normalizeRecoveryCode("O0O0O-O0O0O")).toBe("0000000000");
    expect(normalizeRecoveryCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeRecoveryCode("ABCDE-FGHJU")).toBeNull();
    const h = hashRecoveryCode(hmacKey, code);
    expect(h).toBe(hmacHex(hmacKey, "recovery_code", code));
    expect(h).not.toBe(createHash("sha256").update(code).digest("hex"));
  });
});

describe("authentication secrets (A7)", () => {
  it("needs a versioned MFA keyring and an HMAC key of at least 32 bytes, all distinct", () => {
    const k = key32();
    const ok = loadAuthSecrets({ IAM_MFA_ENC_KEYS: `1:${k}`, IAM_HMAC_KEY: key32() });
    expect(ok.hmacKey).toHaveLength(32);
    expect(() => loadAuthSecrets({ IAM_HMAC_KEY: key32() })).toThrow(AuthSecretsError);
    expect(() => loadAuthSecrets({ IAM_MFA_ENC_KEYS: `1:${k}` })).toThrow(
      /IAM_HMAC_KEY is not set/,
    );
    expect(() => parseHmacKey(randomBytes(16).toString("base64url"))).toThrow(/at least 32/);
    expect(() => parseHmacKey("not base64url!")).toThrow(/base64url/);
    expect(() => loadAuthSecrets({ IAM_MFA_ENC_KEYS: `1:${k}`, IAM_HMAC_KEY: k })).toThrow(
      /differ/,
    );
  });

  it("never puts a secret value into an error message", () => {
    const secret = randomBytes(16).toString("base64url");
    try {
      parseHmacKey(secret);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret);
    }
  });
});

describe("IP prefixes", () => {
  it("keeps /24 for IPv4 and /48 for IPv6, never the full address", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(ipPrefix("::1")).toBe("0:0:0::/48");
    expect(ipPrefix("not-an-ip")).toBeNull();
  });
});
