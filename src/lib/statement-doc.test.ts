import { describe, expect, it } from "vitest";
import { keyText, shareText, statementDoc } from "./statement-doc";

describe("statementDoc", () => {
  const base = {
    year: 2025,
    propertyName: "Haus Linde",
    propertyAddress: "Lindenstr. 1, 10115 Berlin",
    unitLabel: "WE 3",
    renterNames: ["Erika Muster"],
    costs: [
      { id: "g", type: "GRUNDSTEUER", amount: 1200, note: null },
      { id: "h", type: "HEIZUNG", amount: 5000, note: "Gas" },
    ],
    items: [
      { costId: "g", amount: 240, basis: [{ method: "AREA" as const, portion: 1, unitValue: 60, totalValue: 300 }] },
      {
        costId: "h",
        amount: 1100.5,
        basis: [
          { method: "AREA" as const, portion: 0.3, unitValue: 60, totalValue: 300 },
          { method: "CONSUMPTION" as const, portion: 0.7, unitValue: 1234.5, totalValue: 5000 },
        ],
      },
    ],
    allocated: 1340.5,
    prepayment: 1200,
    balance: -140.5,
  };

  it("eine Zeile je Kostenart mit Gesamtkosten, Schlüssel, Anteil und Betrag", () => {
    const d = statementDoc({ ...base, period: { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-12-31T00:00:00Z") } });
    expect(d.subject).toBe("Betriebskostenabrechnung 2025");
    expect(d.rows).toEqual([
      { costType: "Grundsteuer", total: 1200, key: "Wohnfläche", share: "60,00 von 300,00 m²", amount: 240 },
      {
        costType: "Heizung (Gas)",
        total: 5000,
        key: "30 % Wohnfläche\n70 % Verbrauch",
        share: "60,00 von 300,00 m²\n1.234,5 von 5.000,0 Verbr.",
        amount: 1100.5,
      },
    ]);
    expect(d.result).toBe("Nachzahlung: 140,50 €");
    expect(d.totals[1][1]).toBe("– 1.200,00 €");
    expect(d.notes.some((n) => n.includes("Nutzungszeitraum"))).toBe(false); // ganzjährig
    expect(d.notes.some((n) => n.includes("Heizkostenverordnung"))).toBe(true);
  });

  it("unterjährig: Nutzungszeitraum und Hinweis zur Umrechnung; Guthaben", () => {
    const d = statementDoc({ ...base, balance: 50, period: { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-12-31T00:00:00Z") } });
    expect(d.facts).toContainEqual(["Ihr Nutzungszeitraum", "01.04.2025 – 31.12.2025"]);
    expect(d.notes[0]).toContain("Nutzungszeitraum");
    expect(d.result).toBe("Guthaben: 50,00 €");
  });

  it("Schlüsseltexte", () => {
    expect(keyText([{ method: "UNITS", portion: 1, unitValue: 1, totalValue: 8 }])).toBe("Einheiten");
    expect(shareText([{ method: "UNITS", portion: 1, unitValue: 1, totalValue: 8 }])).toBe("1 von 8 Einh.");
    expect(shareText([{ method: "PERSONS", portion: 1, unitValue: 2, totalValue: 14 }])).toBe("2 von 14 Pers.");
  });
});
