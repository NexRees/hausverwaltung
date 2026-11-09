import "server-only";
import { prisma } from "@/lib/prisma";
import { statementDoc } from "@/lib/statement-doc";
import { senderLines, tenantContact } from "@/server/letters";
import { statementPdf } from "@/server/statement-pdf";
import type { StatementResult, StatementUnit } from "@/server/statements";

// nexrees: Betriebskostenabrechnung eines Mietverhältnisses als Brief-PDF (Einzelaufstellung).
// Geteilt von „An Mieter mailen“ und dem PDF-Download je Zeile.

export async function statementPdfFor(tenantId: string, st: StatementResult, u: StatementUnit, year: number) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, address: true, phone: true, smtpFrom: true } });
  const { lines, city } = senderLines(t?.address);
  const p = st.property;
  const doc = statementDoc({
    year,
    propertyName: p?.name ?? "",
    propertyAddress: p ? `${p.street}, ${p.zip} ${p.city}` : "",
    unitLabel: u.label,
    renterNames: u.renterNames,
    period: u.period,
    costs: st.costs,
    items: u.items,
    allocated: u.allocated,
    prepayment: u.prepayment,
    balance: u.balance,
  });
  const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date());
  return statementPdf({
    sender: { name: t?.name ?? p?.tenantName ?? "", lines: [...lines, ...tenantContact(t)] },
    // Anschriftfeld: Mieter (eine Zeile) + Objektanschrift
    recipient: [u.renterNames.join(", "), p?.street ?? "", p ? `${p.zip} ${p.city}` : ""],
    place: city,
    date,
    doc,
  });
}
