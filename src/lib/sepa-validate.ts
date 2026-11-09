// nexrees: checksums for SEPA identifiers (ISO 13616 IBAN, EPC creditor identifier), so a
// direct-debit file is never built with a typo the bank would reject days later.

function mod97(digits: string): number {
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return r;
}
const toDigits = (s: string) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

export function ibanValid(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  return mod97(toDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** Gläubiger-Identifikationsnummer, e.g. DE98ZZZ09999999999 (Bundesbank test id). */
export function creditorIdValid(raw: string): boolean {
  const id = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) return false;
  if (id.startsWith("DE") && id.length !== 18) return false;
  const national = id.slice(7); // business code (positions 5-7) is not part of the checksum
  return mod97(toDigits(national + id.slice(0, 2) + id.slice(2, 4))) === 1;
}

export function bicValid(raw: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s+/g, "").toUpperCase());
}
