import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-crypto";
});

describe("encryptSecret/decryptSecret", () => {
  it("roundtrip", () => {
    const plain = "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----";
    const enc = encryptSecret(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("abc123");
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("verschiedene IVs je Aufruf", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("manipuliertes Ciphertext wirft (GCM-Tag)", () => {
    const enc = encryptSecret("geheim");
    const broken = "v1:" + Buffer.from("00".repeat(40), "hex").toString("base64");
    expect(() => decryptSecret(broken)).toThrow();
  });
});

describe("nexrees: openSecret and production key guard", () => {
  it("reads encrypted and legacy plaintext values", async () => {
    const { openSecret } = await import("./crypto");
    expect(openSecret(encryptSecret("smtp-pass"))).toBe("smtp-pass");
    expect(openSecret("legacy-plain")).toBe("legacy-plain");
    expect(openSecret(null)).toBeUndefined();
  });

  it("refuses to encrypt with a weak AUTH_SECRET in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { secret: env.AUTH_SECRET, node: env.NODE_ENV };
    try {
      env.NODE_ENV = "production";
      env.AUTH_SECRET = "change-me";
      expect(() => encryptSecret("x")).toThrow(/AUTH_SECRET/);
      env.AUTH_SECRET = "x".repeat(48);
      expect(decryptSecret(encryptSecret("x"))).toBe("x");
    } finally {
      env.AUTH_SECRET = before.secret;
      env.NODE_ENV = before.node;
    }
  });
});
