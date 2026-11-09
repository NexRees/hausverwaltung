// nexrees: Inhalt der Betriebskostenabrechnung je Mietverhältnis (rein, ohne PDF-Satz).
// Eine Abrechnung muss für jede Kostenart die Gesamtkosten, den Verteilerschlüssel, den
// Anteil des Mieters und den Abzug der Vorauszahlungen nachvollziehbar zeigen. Die
// bisherige PDF-Fassung enthielt nur die drei Summen. Satz: src/server/statement-pdf.ts.

import type { AllocationMethod } from "@/lib/allocation";
import type { StatementBasis, StatementItem } from "@/lib/allocation/statement";

export const COST_TYPE_DE: Record<string, string> = {
  GRUNDSTEUER: "Grundsteuer",
  WASSER: "Wasserversorgung",
  ENTWAESSERUNG: "Entwässerung",
  HEIZUNG: "Heizung",
  WARMWASSER: "Warmwasser",
  AUFZUG: "Aufzug",
  STRASSENREINIGUNG: "Straßenreinigung",
  MUELL: "Müllbeseitigung",
  GEBAEUDEREINIGUNG: "Gebäudereinigung",
  GARTENPFLEGE: "Gartenpflege",
  BELEUCHTUNG: "Beleuchtung",
  SCHORNSTEIN: "Schornsteinreinigung",
  VERSICHERUNG: "Sach- und Haftpflichtversicherung",
  HAUSWART: "Hauswart",
  KABEL: "Kabel/Antenne",
  INSTANDHALTUNG: "Instandhaltung",
  VERWALTUNG: "Verwaltung",
  SONSTIGE: "Sonstige Betriebskosten",
};

const METHOD_DE: Record<AllocationMethod, string> = {
  AREA: "Wohnfläche",
  UNITS: "Einheiten",
  PERSONS: "Personen",
  CONSUMPTION: "Verbrauch",
  MEA: "Miteigentumsanteile",
  CUSTOM: "Festanteil",
};

const UNIT_DE: Record<AllocationMethod, string> = {
  AREA: "m²",
  UNITS: "Einh.",
  PERSONS: "Pers.",
  CONSUMPTION: "Verbr.",
  MEA: "MEA",
  CUSTOM: "",
};

const num = (n: number, digits = 2) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const eur = (n: number) => `${num(n)} €`;
const day = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);

const DIGITS: Record<AllocationMethod, number> = { AREA: 2, UNITS: 0, PERSONS: 0, CONSUMPTION: 1, MEA: 0, CUSTOM: 2 };
const pct = (p: number) => `${Math.round(p * 100)} %`;

/** "Wohnfläche" bzw. bei Heizkosten "30 % Wohnfläche" und "70 % Verbrauch" untereinander. */
export function keyText(basis: StatementBasis[]): string {
  if (basis.length === 1 && basis[0].portion === 1) return METHOD_DE[basis[0].method];
  return basis.map((b) => `${pct(b.portion)} ${METHOD_DE[b.method]}`).join("\n");
}

/** Anteil der Einheit, z. B. "75,00 von 600,00 m²"; bei Heizkosten je Basis eine Zeile. */
export function shareText(basis: StatementBasis[]): string {
  return basis
    .map((b) => `${num(b.unitValue, DIGITS[b.method])} von ${num(b.totalValue, DIGITS[b.method])} ${UNIT_DE[b.method]}`.trim())
    .join("\n");
}

export interface StatementRow {
  costType: string;
  total: number; // Gesamtkosten der Position im Objekt (bzw. der Untergemeinschaft)
  key: string;
  share: string;
  amount: number; // Anteil dieses Mietverhältnisses
}

export interface StatementDocInput {
  year: number;
  propertyName: string;
  propertyAddress: string; // "Straße, PLZ Ort"
  unitLabel: string;
  renterNames: string[];
  period: { from: Date; to: Date } | null;
  costs: { id: string; type: string; amount: number; note: string | null }[];
  items: StatementItem[];
  allocated: number;
  prepayment: number;
  balance: number;
}

export interface StatementDoc {
  subject: string;
  facts: [string, string][]; // Objekt, Einheit, Zeiträume
  rows: StatementRow[];
  totals: [string, string][];
  result: string; // "Nachzahlung: 123,45 €" bzw. "Guthaben: …"
  notes: string[];
}

export function statementDoc(i: StatementDocInput): StatementDoc {
  const costById = new Map(i.costs.map((c) => [c.id, c]));
  const rows: StatementRow[] = i.items.map((it) => {
    const c = costById.get(it.costId);
    const name = COST_TYPE_DE[c?.type ?? ""] ?? c?.type ?? "Kosten";
    return {
      costType: c?.note ? `${name} (${c.note})` : name,
      total: c?.amount ?? 0,
      key: keyText(it.basis),
      share: shareText(it.basis),
      amount: it.amount,
    };
  });

  const yearFrom = new Date(Date.UTC(i.year, 0, 1));
  const yearTo = new Date(Date.UTC(i.year, 11, 31));
  const facts: [string, string][] = [
    ["Objekt", [i.propertyName, i.propertyAddress].filter(Boolean).join(", ")],
    ["Wohnung", i.unitLabel],
    ["Abrechnungszeitraum", `${day(yearFrom)} – ${day(yearTo)}`],
  ];
  if (i.period) facts.push(["Ihr Nutzungszeitraum", `${day(i.period.from)} – ${day(i.period.to)}`]);

  const credit = i.balance >= 0;
  const heating = rows.some((r) => r.key.includes("Verbrauch"));
  const partYear =
    i.period && (i.period.from.getTime() > yearFrom.getTime() || i.period.to.getTime() < yearTo.getTime());

  return {
    subject: `Betriebskostenabrechnung ${i.year}`,
    facts,
    rows,
    totals: [
      ["Summe Ihrer Betriebskosten", eur(i.allocated)],
      ["abzüglich Ihrer Vorauszahlungen", `– ${eur(i.prepayment)}`],
    ],
    result: `${credit ? "Guthaben" : "Nachzahlung"}: ${eur(Math.abs(i.balance))}`,
    notes: [
      ...(partYear
        ? ["Kosten nach Fläche, Einheiten, Personen oder Miteigentumsanteilen sind auf Ihren Nutzungszeitraum (volle Monate) umgerechnet."]
        : []),
      ...(heating
        ? ["Heiz- und Warmwasserkosten sind nach der Heizkostenverordnung teils nach Wohnfläche, teils nach gemessenem Verbrauch verteilt."]
        : []),
      "Nicht umlagefähige Kosten (z. B. Verwaltung, Instandhaltung) sind nicht enthalten.",
      "Die Belege zu dieser Abrechnung können Sie nach Terminabsprache bei uns einsehen.",
      credit
        ? "Ihr Guthaben wird Ihnen erstattet."
        : "Bitte überweisen Sie den Nachzahlungsbetrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung.",
    ],
  };
}
