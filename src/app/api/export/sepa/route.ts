import { auth } from "@/auth";
import { actingTenantId } from "@/lib/acting-tenant";
import { prisma } from "@/lib/prisma";
import { roleAllows } from "@/lib/rbac";
import { toPain008, earliestCollectionDate, isTargetDay, sepaText, type SepaEntry } from "@/lib/adapters/sepa";
import { creditorIdValid, ibanValid, bicValid, normalizeIban, mandateRefValid } from "@/lib/sepa-validate";
import { sepaDueByLease } from "@/server/charge-ledger";
import { asActor } from "@/server/ledger";
import { audit } from "@/lib/audit";

// nexrees: rewritten (see src/lib/adapters/sepa.ts). What is collected: for each active mandate,
// the open amount of the charges of the debtor's leases that fall due in the 35 days up to the
// collection date, have no dunning notice yet and are not in an earlier file. Older arrears are not
// swept into a direct debit (they need their own pre-notification and are handled by dunning).
// Credits and overpayments of the lease reduce the debit (never more than the lease's balance).
// Every file is recorded (SepaCollection) so a second download does not debit anybody twice; a
// file that was never submitted can be cancelled in Finanzen → Import/Export.
// POST (form field or ?date=YYYY-MM-DD) sets the collection date (default: earliest possible, two
// TARGET days ahead). GET is refused: creating a file changes data.

const WINDOW_DAYS = 35;

function problem(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET() {
  return problem(405, "SEPA-Lastschriftdateien werden unter Finanzen → Import/Export erstellt (POST).");
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!roleAllows(session.user.role, ["VERWALTER", "BUCHHALTUNG"]))
    return new Response("Forbidden", { status: 403 });

  const tenantId = await actingTenantId(session.user);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, sepaCreditorId: true, sepaCreditorIban: true, sepaCreditorBic: true },
  });
  const creditorId = tenant?.sepaCreditorId?.replace(/\s+/g, "").toUpperCase() ?? "";
  const creditorIban = normalizeIban(tenant?.sepaCreditorIban ?? "");
  const creditorBic = tenant?.sepaCreditorBic?.replace(/\s+/g, "").toUpperCase() || null;
  if (!tenant || !creditorIdValid(creditorId) || !ibanValid(creditorIban) || (creditorBic && !bicValid(creditorBic)) || !sepaText(tenant.name, 70)) {
    return problem(422, "SEPA-Lastschrift: Gläubiger-ID und Gläubiger-IBAN fehlen oder sind ungültig. Bitte unter Einstellungen → Buchhaltung eintragen.");
  }

  const earliest = earliestCollectionDate(new Date());
  let raw = new URL(req.url).searchParams.get("date");
  if (!raw && req.headers.get("content-type")?.includes("form")) {
    raw = String((await req.formData()).get("date") ?? "") || null;
  }
  let collectionDate = earliest;
  if (raw) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(NaN);
    if (Number.isNaN(d.getTime()) || d < earliest || !isTargetDay(d)) {
      return problem(422, `Einzugsdatum ${raw} ist nicht möglich. Frühestens ${earliest.toISOString().slice(0, 10)} und nur an Bankarbeitstagen.`);
    }
    collectionDate = d;
  }
  const windowStart = new Date(collectionDate.getTime() - WINDOW_DAYS * 86_400_000);

  const mandates = await prisma.sepaMandate.findMany({
    where: { tenantId, active: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, mandateRef: true, iban: true, signedDate: true, lastCollectedAt: true,
      person: { select: { firstName: true, lastName: true, renters: { select: { leaseId: true } } } },
    },
  });
  const byLease = new Map((await sepaDueByLease(tenantId, windowStart, collectionDate)).map((r) => [r.leaseId, r]));

  const msgId = `NR${tenantId.slice(-8)}${Date.now().toString(36)}`.toUpperCase();
  const entries: SepaEntry[] = [];
  const items: { chargeId: string; mandateId: string; endToEndId: string }[] = [];
  const invalid: string[] = [];
  const used: string[] = [];
  const seenLeases = new Set<string>();
  for (const m of mandates) {
    // one lease is collected through one mandate only, even if several renters have one (and even
    // if the same person is entered twice as renter of a lease)
    const leases = [...new Set(m.person.renters.map((r) => r.leaseId))].filter((id) => !seenLeases.has(id));
    const due = leases.map((id) => byLease.get(id)).filter((r) => r !== undefined);
    // never more than the lease owes in total: credits and overpayments reduce the debit
    const amount = Math.round(due.reduce((a, r) => a + Math.max(0, Math.min(r.due, r.balance)), 0) * 100) / 100;
    if (amount <= 0) continue;
    const who = `${m.mandateRef} (${m.person.firstName} ${m.person.lastName})`;
    const iban = normalizeIban(m.iban);
    const debtorName = `${m.person.firstName} ${m.person.lastName}`.trim();
    const problems = [
      !ibanValid(iban) && "IBAN ungültig",
      !mandateRefValid(m.mandateRef) && "Mandatsreferenz enthält unzulässige Zeichen (Mandat mit gültiger Referenz neu erfassen)",
      !sepaText(debtorName, 70) && "Name des Kontoinhabers bitte in lateinischer Schrift hinterlegen",
    ].filter(Boolean);
    if (problems.length) {
      invalid.push(`${who}: ${problems.join(", ")}`);
      continue;
    }
    leases.forEach((id) => seenLeases.add(id));
    const periods = [...new Set(due.flatMap((r) => r.periods).map((p) => `${String(p.getUTCMonth() + 1).padStart(2, "0")}/${p.getUTCFullYear()}`))];
    const endToEndId = `${msgId}-${entries.length + 1}`;
    entries.push({
      mandateRef: m.mandateRef,
      mandateSignedAt: m.signedDate,
      sequence: m.lastCollectedAt ? "RCUR" : "FRST",
      iban,
      debtorName,
      amount,
      reference: `${tenant.name} ${periods.join(" ")} Mandat ${m.mandateRef}`,
      endToEndId,
    });
    for (const r of due) for (const chargeId of r.chargeIds) items.push({ chargeId, mandateId: m.id, endToEndId });
    used.push(m.id);
  }

  if (invalid.length) return problem(422, `SEPA-Lastschrift nicht erstellt. Bitte korrigieren:\n${invalid.join("\n")}`);
  if (entries.length === 0) return problem(404, "Keine offenen Beträge mit aktivem SEPA-Mandat im Einzugszeitraum.");

  const xml = toPain008(entries, {
    creditor: { name: tenant.name, iban: creditorIban, bic: creditorBic, creditorId },
    msgId,
    createdAt: new Date(),
    collectionDate,
  });
  const total = Math.round(entries.reduce((a, e) => a + e.amount, 0) * 100) / 100;

  // Record the file and its charges, and mark mandates used once as RCUR from now on (since the
  // 2016 EPC rulebook a first debit may be RCUR too). One transaction, journaled with the user.
  const actor = { id: session.user.id, name: session.user.name ?? session.user.email ?? null, source: "ui" };
  await asActor(actor, async (tx) => {
    await tx.sepaCollection.create({
      data: {
        tenantId, msgId, collectionDate, total, count: entries.length,
        createdById: actor.id, createdByName: actor.name,
        items: { create: items.map((i) => ({ ...i, tenantId })) },
      },
    });
    await tx.sepaMandate.updateMany({ where: { id: { in: used }, lastCollectedAt: null }, data: { lastCollectedAt: new Date() } });
  });
  await audit(
    { ...session.user, tenantId, homeTenantId: session.user.tenantId },
    "CREATE", "SepaCollection", msgId,
    `SEPA-Lastschrift ${entries.length} Einzüge, ${total.toFixed(2)} €, Einzug ${collectionDate.toISOString().slice(0, 10)}`,
  );

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="sepa-lastschrift-${collectionDate.toISOString().slice(0, 10)}.xml"`,
      "Cache-Control": "no-store",
    },
  });
}
