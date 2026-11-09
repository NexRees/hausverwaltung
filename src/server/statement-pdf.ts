import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { BRAND } from "@/lib/brand";
import { eur, type StatementDoc } from "@/lib/statement-doc";

// nexrees: Betriebskostenabrechnung als Brief (DIN 5008 Form B, PDF/A-1b), mit
// Einzelaufstellung je Kostenart, mehrseitig. Briefkopf und Anschriftfeld wie in
// letter-pdf.ts (gleiche Maße, passt in Fensterumschlag und Pingen/E-POST-Zonen);
// bewusst eine eigene Datei, damit die HaVeWa-Datei unverändert bleibt.

const FONTS = path.join(process.cwd(), "src/assets/fonts");
const mm = (v: number) => v * 2.834645669;

export type StatementPdfInput = {
  sender: { name: string; lines: string[] };
  recipient: string[]; // max. 4 Zeilen
  place: string;
  date: string;
  doc: StatementDoc;
};

// Spalten: Kostenart | Gesamtkosten | Verteilerschlüssel | Ihr Anteil | Betrag (Summe 165 mm)
const COLS = [
  { w: 40, align: "left" as const },
  { w: 26, align: "right" as const },
  { w: 34, align: "left" as const },
  { w: 40, align: "left" as const },
  { w: 25, align: "right" as const },
];
const LEFT = 25;
const PAD = 1.2; // mm Abstand zwischen Spalten

export function statementPdf(s: StatementPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: mm(20), bottom: mm(25), left: mm(LEFT), right: mm(20) },
    pdfVersion: "1.4",
    subset: "PDF/A-1b",
    font: path.join(FONTS, "LiberationSans-Regular.ttf"),
    info: { Title: s.doc.subject, Author: s.sender.name, Creator: BRAND.name },
    lang: "de-DE",
    bufferPages: true,
  });
  doc.registerFont("R", path.join(FONTS, "LiberationSans-Regular.ttf"));
  doc.registerFont("B", path.join(FONTS, "LiberationSans-Bold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // Briefkopf rechts, Anschriftfeld, Datum, Betreff (wie letter-pdf.ts)
  doc.font("B").fontSize(10).text(s.sender.name, mm(125), mm(32), { width: mm(65) });
  doc.font("R").fontSize(9);
  for (const line of s.sender.lines) doc.text(line, { width: mm(65) });
  doc.font("R").fontSize(9);
  s.recipient
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .forEach((line, i) => doc.text(line, mm(LEFT), mm(70) + i * mm(3.6), { width: mm(80), lineBreak: false }));
  doc.fontSize(10).text([s.place, s.date].filter(Boolean).join(", "), mm(LEFT), mm(98), { width: mm(165), align: "right" });
  doc.font("B").fontSize(11).text(s.doc.subject, mm(LEFT), mm(106), { width: mm(165) });

  // Eckdaten
  doc.moveDown(0.8).fontSize(9.5);
  for (const [k, v] of s.doc.facts) {
    const y = doc.y;
    doc.font("R").text(k, mm(LEFT), y, { width: mm(45) });
    doc.font("B").text(v, mm(LEFT + 45), y, { width: mm(120) });
  }

  // Tabelle
  doc.moveDown(1);
  const header = ["Kostenart", "Gesamtkosten", "Verteilerschlüssel", "Ihr Anteil", "Ihr Betrag"];
  const row = (cells: string[], font: "R" | "B", size: number) => {
    doc.font(font).fontSize(size);
    const heights = cells.map((c, i) => doc.heightOfString(c, { width: mm(COLS[i].w - PAD) }));
    const h = Math.max(...heights) + 4;
    if (doc.y + h > bottom()) {
      doc.addPage();
      drawHeader();
      doc.font(font).fontSize(size);
    }
    const y = doc.y;
    let x = mm(LEFT);
    cells.forEach((c, i) => {
      doc.text(c, x, y + 2, { width: mm(COLS[i].w - PAD), align: COLS[i].align });
      x += mm(COLS[i].w);
    });
    doc.y = y + h;
    return y;
  };
  const rule = (weight = 0.5) => {
    doc.moveTo(mm(LEFT), doc.y).lineTo(mm(LEFT + 165), doc.y).lineWidth(weight).strokeColor("#000").stroke();
  };
  const drawHeader = () => {
    row(header, "B", 8.5);
    rule(0.8);
  };
  drawHeader();
  for (const r of s.doc.rows) {
    row([r.costType, eur(r.total), r.key, r.share, eur(r.amount)], "R", 8.5);
    doc.moveTo(mm(LEFT), doc.y).lineTo(mm(LEFT + 165), doc.y).lineWidth(0.2).strokeColor("#999").stroke();
  }
  if (s.doc.rows.length === 0) row(["Keine umlagefähigen Kosten", "", "", "", eur(0)], "R", 8.5);

  // Summen rechtsbündig
  doc.moveDown(0.6);
  const sumLine = (label: string, value: string, bold = false) => {
    if (doc.y + 16 > bottom()) doc.addPage();
    const y = doc.y;
    doc.font(bold ? "B" : "R").fontSize(bold ? 10.5 : 9.5);
    doc.text(label, mm(LEFT + 66), y, { width: mm(74) });
    doc.text(value, mm(LEFT + 140), y, { width: mm(25 - PAD), align: "right" });
    doc.y = y + (bold ? 15 : 13);
  };
  for (const [k, v] of s.doc.totals) sumLine(k, v);
  rule(0.8);
  doc.moveDown(0.3);
  const [resLabel, resValue] = s.doc.result.split(": ");
  sumLine(resLabel, resValue, true);

  // Hinweise
  doc.moveDown(1).font("R").fontSize(9);
  for (const n of s.doc.notes) {
    if (doc.y + 24 > bottom()) doc.addPage();
    doc.text(n, mm(LEFT), doc.y, { width: mm(165), lineGap: 1 });
    doc.moveDown(0.4);
  }
  doc.moveDown(0.8).fontSize(10).text("Mit freundlichen Grüßen", mm(LEFT), doc.y, { width: mm(165) });
  doc.moveDown(0.4).text(s.sender.name, { width: mm(165) });

  // Seitenzahlen
  const { start, count } = doc.bufferedPageRange();
  if (count > 1) {
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font("R").fontSize(8).text(`Seite ${i + 1} von ${count}`, mm(LEFT), mm(285), { width: mm(165), align: "right" });
    }
  }
  doc.end();
  return done;
}
