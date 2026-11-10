import type { PrismaClient } from "@prisma/client";

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
 * nexrees: § 551 Abs. 1 BGB: a residential deposit may be at most three times the monthly rent
 * without the operating cost prepayments or flat rates. That is the Kaltmiete plus rent parts such
 * as a parking space let with the flat, a modernisation surcharge or a furniture surcharge.
 * Agreements above that are void to that extent (§ 551 Abs. 4). Commercial and parking units are
 * not covered.
 */
export function depositCapProblem(amount: number, monthlyRent: number, unitType: string): string | null {
  if (unitType !== "WOHNUNG") return null;
  const cap = Math.round(monthlyRent * 3 * 100) / 100;
  if (amount > cap + 0.005) {
    return `Kaution ${amount.toFixed(2).replace(".", ",")} € übersteigt drei Monatsmieten ohne Betriebskosten (${cap.toFixed(2).replace(".", ",")} €, § 551 Abs. 1 BGB).`;
  }
  return null;
}

/** Rent components that are operating costs and do not count for the deposit cap. */
const OPERATING_COST_COMPONENTS = new Set(["NEBENKOSTEN", "HEIZKOSTEN"]);

export function depositBaseRent(rentCold: number, components: { type: string; amount: unknown }[]): number {
  return rentCold + components.filter((c) => !OPERATING_COST_COMPONENTS.has(c.type)).reduce((a, c) => a + Number(c.amount), 0);
}

type DepositDb = Pick<PrismaClient, "lease" | "deposit">;

/**
 * The cap check for a save: only when the deposit is new or its amount changes, so an existing
 * deposit (recorded before this rule, or after the rent fell) can still get its return date,
 * interest or note.
 */
export async function depositCapFor(db: DepositDb, tenantId: string, leaseId: string, amount: number): Promise<string | null> {
  const existing = await db.deposit.findFirst({ where: { leaseId, tenantId }, select: { amount: true } });
  if (existing && Math.abs(Number(existing.amount) - amount) < 0.005) return null;
  const l = await db.lease.findFirst({
    where: { id: leaseId, tenantId },
    select: { rentCold: true, unit: { select: { type: true } }, components: { select: { type: true, amount: true } } },
  });
  return l ? depositCapProblem(amount, depositBaseRent(Number(l.rentCold), l.components), l.unit.type) : null;
}
