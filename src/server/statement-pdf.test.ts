import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { statementDoc } from "@/lib/statement-doc";

vi.mock("server-only", () => ({}));
const { statementPdf } = await import("./statement-pdf");

describe("statementPdf (nexrees)", () => {
  it("setzt viele Kostenarten mehrseitig und bleibt ein gültiges PDF", async () => {
    const n = 40;
    const doc = statementDoc({
      year: 2025,
      propertyName: "Haus Linde",
      propertyAddress: "Lindenstr. 1, 10115 Berlin",
      unitLabel: "WE 3",
      renterNames: ["Erika Muster"],
      period: { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-12-31T00:00:00Z") },
      costs: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, type: "SONSTIGE", amount: 1000 + i, note: `Position ${i}` })),
      items: Array.from({ length: n }, (_, i) => ({
        costId: `c${i}`,
        amount: 10,
        basis: [
          { method: "AREA" as const, portion: 0.3, unitValue: 60, totalValue: 300 },
          { method: "CONSUMPTION" as const, portion: 0.7, unitValue: 10, totalValue: 100 },
        ],
      })),
      allocated: 10 * n,
      prepayment: 300,
      balance: 300 - 10 * n,
    });
    const pdf = await statementPdf({
      sender: { name: "NexRees Verwaltung", lines: ["Hauptstr. 1", "10115 Berlin"] },
      recipient: ["Erika Muster", "Lindenstr. 1", "10115 Berlin"],
      place: "Berlin",
      date: "09.11.2026",
      doc,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });
});
