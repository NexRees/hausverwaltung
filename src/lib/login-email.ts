// nexrees: e-mail sign-in ignores case and surrounding spaces ("Mieter@HaVeWa.app " = "mieter@havewa.app").

/** E-mail as typed at the login, in canonical form: trimmed, lower case; "" for anything else. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Prisma's `equals` with `mode: "insensitive"` compiles to ILIKE, where "%" and "_" are wildcards.
 * Escaped, they only match themselves ("a_b@x.de" must not match "axb@x.de").
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Of the users whose e-mail matches case-insensitively, the one whose password is checked: the
 * exact (lower-case) match, else the only candidate. Several case variants without an exact match
 * are ambiguous, so none is picked.
 */
export function pickLoginUser<T extends { email: string }>(candidates: T[], email: string): T | null {
  const wanted = normalizeEmail(email);
  if (!wanted) return null;
  const matching = candidates.filter((c) => c.email.toLowerCase() === wanted);
  return matching.find((c) => c.email === wanted) ?? (matching.length === 1 ? matching[0] : null);
}
