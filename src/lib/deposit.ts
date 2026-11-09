// Kautionsverzinsung (taggenau; nexrees: mit jährlichem Zinseszins, § 551 Abs. 3 BGB).

const DAY = 86_400_000;

/**
 * Zins auf die Kaution über die Haltedauer.
 * @param amount Kautionsbetrag
 * @param ratePct Zinssatz % p.a. (null/0 = kein Zins)
 * @param from Erhalten am
 * @param to Rückzahlung/Stichtag (default: from, wenn null → 0 Tage)
 */
export function depositInterest(
  amount: number,
  ratePct: number | null | undefined,
  from: Date | null | undefined,
  to: Date | null | undefined,
): number {
  if (!ratePct || !from) return 0;
  const end = to ?? new Date();
  const days = Math.max(0, Math.floor((end.getTime() - from.getTime()) / DAY));
  // nexrees: § 551 Abs. 3 S. 4 BGB: interest increases the deposit, so it compounds once a year
  // (as on a savings account); the part-year is simple interest on the grown amount.
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  const r = ratePct / 100;
  const grown = amount * Math.pow(1 + r, years) * (1 + (r * rest) / 365);
  return Math.round((grown - amount) * 100) / 100;
}

/**
 * nexrees: § 551 Abs. 1 BGB: a residential deposit may be at most three months' rent without
 * operating cost prepayments (Nettokaltmiete). Agreements above that are void to that extent
 * (§ 551 Abs. 4). Commercial and parking units are not covered.
 */
export function depositCapProblem(amount: number, rentCold: number, unitType: string): string | null {
  if (unitType !== "WOHNUNG") return null;
  const cap = Math.round(rentCold * 3 * 100) / 100;
  if (amount > cap + 0.005) {
    return `Kaution ${amount.toFixed(2).replace(".", ",")} € übersteigt drei Nettokaltmieten (${cap.toFixed(2).replace(".", ",")} €, § 551 Abs. 1 BGB).`;
  }
  return null;
}
