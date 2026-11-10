import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
process.env.AUTH_SECRET = "test-secret-for-backfill";

describe("legacySecretUpdates", () => {
  it("encrypts plaintext columns and leaves encrypted or empty ones alone", async () => {
    const { legacySecretUpdates } = await import("./secret-backfill");
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const already = encryptSecret("imap");
    const out = legacySecretUpdates({ smtpPassword: "smtp", imapPassword: already, aiApiKey: null });
    expect(Object.keys(out)).toEqual(["smtpPassword"]);
    expect(decryptSecret(out.smtpPassword!)).toBe("smtp");
  });
});
