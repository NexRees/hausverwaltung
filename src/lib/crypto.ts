import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Symmetrische Verschlüsselung sensibler Secrets (z. B. Bank-Connector-Private-Key)
// at-rest in der DB. Schlüssel wird aus AUTH_SECRET abgeleitet (AES-256-GCM).
// Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).

// nexrees: in production a missing or placeholder AUTH_SECRET must not silently encrypt
// credentials with a key that is public in this repository.
const WEAK_SECRETS = new Set(["", "change-me", "havewa-dev-secret-change-me"]);

let cached: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const env = process.env.AUTH_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && (WEAK_SECRETS.has(env) || env.length < 32)) {
    throw new Error("AUTH_SECRET fehlt oder ist zu schwach (mind. 32 Zeichen) – Secrets können nicht sicher verschlüsselt werden.");
  }
  const secret = env || "havewa-dev-secret-change-me";
  if (cached?.secret !== secret) cached = { secret, key: scryptSync(secret, "havewa-secret-v1", 32) };
  return cached.key;
}

/** nexrees: true when the value was written by encryptSecret. */
export function isEncryptedSecret(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("v1:");
}

/**
 * nexrees: read a credential column that may still hold a plaintext value from before
 * encryption was introduced. Encrypted values are decrypted; legacy plaintext is returned as is
 * (and re-encrypted by encryptLegacySecrets on the next start).
 */
export function openSecret(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return isEncryptedSecret(value) ? decryptSecret(value) : value;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(enc: string): string {
  if (!enc.startsWith("v1:")) throw new Error("Unbekanntes Secret-Format");
  const raw = Buffer.from(enc.slice(3), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
