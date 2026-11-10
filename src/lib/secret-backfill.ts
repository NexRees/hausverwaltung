import { prisma } from "@/lib/prisma";
import { encryptSecret, isEncryptedSecret } from "@/lib/crypto";

// nexrees: credentials stored before encryption at rest (SMTP, IMAP, AI key) are encrypted once on
// start. Idempotent: encrypted values start with "v1:" and are left alone. Concurrent instances may
// both encrypt the same value; each result decrypts to the same plaintext, so the last write wins
// harmlessly.

export const SECRET_COLUMNS = ["smtpPassword", "imapPassword", "aiApiKey"] as const;
type SecretColumn = (typeof SECRET_COLUMNS)[number];

/** Columns of one tenant row that still hold plaintext, mapped to their encrypted value. */
export function legacySecretUpdates(row: Partial<Record<SecretColumn, string | null>>): Partial<Record<SecretColumn, string>> {
  const out: Partial<Record<SecretColumn, string>> = {};
  for (const col of SECRET_COLUMNS) {
    const v = row[col];
    if (v && !isEncryptedSecret(v)) out[col] = encryptSecret(v);
  }
  return out;
}

export async function encryptLegacySecrets(): Promise<number> {
  const rows = await prisma.tenant.findMany({
    where: { OR: SECRET_COLUMNS.map((c) => ({ AND: [{ [c]: { not: null } }, { NOT: { [c]: { startsWith: "v1:" } } }] })) },
    select: { id: true, smtpPassword: true, imapPassword: true, aiApiKey: true },
  });
  let n = 0;
  for (const row of rows) {
    const data = legacySecretUpdates(row);
    if (Object.keys(data).length === 0) continue;
    await prisma.tenant.update({ where: { id: row.id }, data });
    n++;
  }
  return n;
}
