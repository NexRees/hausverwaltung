import { describe, it, expect } from "vitest";
import { costEntryProblem, isAllocatable, statementDeadline, backPaymentExcluded } from "./betrkv";

describe("BetrKV / HeizkostenV rules", () => {
  it("never allocates management or maintenance costs", () => {
    expect(isAllocatable("VERWALTUNG", true)).toBe(false);
    expect(isAllocatable("INSTANDHALTUNG", true)).toBe(false);
    expect(isAllocatable("MUELL", true)).toBe(true);
    expect(isAllocatable("MUELL", false)).toBe(false);
    expect(costEntryProblem({ type: "VERWALTUNG", umlagefaehig: true })).toMatch(/§ 1 Abs. 2 BetrKV/);
    expect(costEntryProblem({ type: "VERWALTUNG", umlagefaehig: false })).toBeNull();
  });

  it("keeps the heating consumption share between 50 and 100 %", () => {
    expect(costEntryProblem({ type: "HEIZUNG", umlagefaehig: true, consumptionSharePct: 30 })).toMatch(/HeizkostenV/);
    expect(costEntryProblem({ type: "HEIZUNG", umlagefaehig: true, consumptionSharePct: 70 })).toBeNull();
    expect(costEntryProblem({ type: "MUELL", umlagefaehig: true, consumptionSharePct: 10 })).toBeNull();
  });

  it("ends the statement period twelve months after the year (§ 556 Abs. 3 BGB)", () => {
    expect(statementDeadline(2025).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(backPaymentExcluded(2025, new Date("2026-12-31T23:00:00Z"))).toBe(false);
    expect(backPaymentExcluded(2025, new Date("2027-01-01T00:00:01Z"))).toBe(true);
  });
});
