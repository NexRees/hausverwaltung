// nexrees: one password rule for every place a password is set (BSI IT-Grundschutz ORP.4,
// NIST SP 800-63B): at least 12 characters, at most 72 bytes (bcrypt ignores the rest), not the
// e-mail address, not a well-known password. Existing passwords keep working until changed.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;

const COMMON = new Set([
  "passwort1234", "password1234", "123456789012", "qwertzuiop12", "qwertyuiop12", "hausverwaltung",
  "nexrees12345", "willkommen123", "sommer2026!!", "winter2026!!", "admin1234567", "changeme1234",
]);

/** German error text, or null when the password is acceptable. */
export function passwordProblem(password: string, email?: string | null): string | null {
  if (password.length < PASSWORD_MIN) return `Passwort zu kurz (mindestens ${PASSWORD_MIN} Zeichen).`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return `Passwort zu lang (höchstens ${PASSWORD_MAX_BYTES} Byte).`;
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return "Passwort besteht nur aus einem Zeichen.";
  if (COMMON.has(lower)) return "Dieses Passwort ist zu verbreitet.";
  const mail = email?.trim().toLowerCase();
  if (mail && (lower === mail || lower === mail.split("@")[0])) return "Passwort darf nicht der E-Mail-Adresse entsprechen.";
  return null;
}
