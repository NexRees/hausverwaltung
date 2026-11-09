// nexrees: rules from the Betriebskostenverordnung and HeizkostenV that the input forms, the API
// and the statement all share.

/**
 * § 1 Abs. 2 BetrKV: management costs (Verwaltungskosten) and maintenance/repair costs
 * (Instandhaltungs- und Instandsetzungskosten) are not operating costs and can never be passed on
 * to residential tenants, whatever the lease says.
 */
export const NEVER_ALLOCATABLE = new Set(["VERWALTUNG", "INSTANDHALTUNG"]);

export function isAllocatable(type: string, flagged: boolean): boolean {
  return flagged && !NEVER_ALLOCATABLE.has(type);
}

/** German error text for a cost position that breaks these rules, or null. */
export function costEntryProblem(c: { type: string; umlagefaehig: boolean; consumptionSharePct?: number | null }): string | null {
  if (c.umlagefaehig && NEVER_ALLOCATABLE.has(c.type)) {
    return "Verwaltungs- und Instandhaltungskosten sind nach § 1 Abs. 2 BetrKV nicht umlagefähig.";
  }
  const heating = c.type === "HEIZUNG" || c.type === "WARMWASSER";
  if (heating && c.consumptionSharePct != null && (c.consumptionSharePct < 50 || c.consumptionSharePct > 100)) {
    // §§ 7, 8 HeizkostenV: at least 50 % by consumption; above 70 % only by agreement (§ 10)
    return "Verbrauchsanteil für Heiz-/Warmwasserkosten muss zwischen 50 und 100 % liegen (§§ 7, 8, 10 HeizkostenV).";
  }
  return null;
}

/**
 * § 556 Abs. 3 S. 2-3 BGB: the operating cost statement for a period must reach the tenant within
 * twelve months after the period ends; afterwards the landlord can no longer claim a back payment
 * (unless not at fault, which the software cannot judge). Credits must still be paid out.
 * Returns the last day (UTC) for a calendar-year period.
 */
export function statementDeadline(year: number): Date {
  return new Date(Date.UTC(year + 1, 11, 31));
}

export function backPaymentExcluded(year: number, now: Date): boolean {
  return now.getTime() > statementDeadline(year).getTime() + 86_400_000 - 1;
}
