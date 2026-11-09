import { describe, expect, it } from "vitest";
import { buildStatement } from "./statement";

// nexrees: Einzelaufstellung je Kostenposition (items) muss exakt zur Zeilensumme passen.
describe("buildStatement – Einzelaufstellung (items)", () => {
  const units = [
    { id: "a", label: "A", area: 60, persons: 2, consumption: 300, leases: [{ id: "la", monthsActive: 12, prepayment: 1200 }] },
    { id: "b", label: "B", area: 40, persons: 1, consumption: 100, leases: [{ id: "lb1", monthsActive: 5, prepayment: 400 }, { id: "lb2", monthsActive: 7, prepayment: 600 }] },
    { id: "c", label: "C", area: 33.33, persons: 1, consumption: 0, leases: [] },
  ];
  const costs = [
    { id: "grund", amount: 1000.01, method: "AREA" as const, umlagefaehig: true },
    { id: "muell", amount: 333.33, method: "UNITS" as const, umlagefaehig: true },
    { id: "heiz", amount: 2500, method: "AREA" as const, umlagefaehig: true, heating: true, consumptionShare: 0.7 },
    { id: "verw", amount: 999, method: "AREA" as const, umlagefaehig: false },
  ];
  const { lines } = buildStatement(units, costs);

  it("Summe der Positionen == allocated, cent-genau, für jede Zeile", () => {
    for (const l of lines) {
      const sum = Math.round(l.items.reduce((a, i) => a + i.amount, 0) * 100);
      expect(sum).toBe(Math.round(l.allocated * 100));
    }
  });

  it("nicht umlagefähige Kosten erscheinen nicht", () => {
    for (const l of lines) expect(l.items.map((i) => i.costId)).not.toContain("verw");
  });

  it("Leerstand hat keine Positionen", () => {
    expect(lines.find((l) => l.unitId === "c")!.items).toEqual([]);
  });

  it("Umlagebasis: Fläche 60 von 133,33 m²; Heizung 30 % Fläche / 70 % Verbrauch", () => {
    const a = lines.find((l) => l.leaseId === "la")!;
    const grund = a.items.find((i) => i.costId === "grund")!;
    expect(grund.basis).toEqual([{ method: "AREA", portion: 1, unitValue: 60, totalValue: expect.closeTo(133.33, 6) }]);
    const heiz = a.items.find((i) => i.costId === "heiz")!;
    expect(heiz.basis.map((b) => [b.method, b.portion, b.unitValue, b.totalValue])).toEqual([
      ["AREA", expect.closeTo(0.3, 10), 60, expect.closeTo(133.33, 6)],
      ["CONSUMPTION", 0.7, 300, 400],
    ]);
  });

  it("Mieterwechsel: zwei Zeilen teilen die Kosten der Einheit nach Monaten", () => {
    const b1 = lines.find((l) => l.leaseId === "lb1")!;
    const b2 = lines.find((l) => l.leaseId === "lb2")!;
    const g1 = b1.items.find((i) => i.costId === "grund")!.amount;
    const g2 = b2.items.find((i) => i.costId === "grund")!.amount;
    expect(g1 / (g1 + g2)).toBeCloseTo(5 / 12, 2);
  });
});
