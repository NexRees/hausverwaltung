import { auth } from "@/auth";
import { actingTenantId } from "@/lib/acting-tenant";
import { prisma } from "@/lib/prisma";
import { roleAllows } from "@/lib/rbac";
import { toPain008, earliestCollectionDate, isTargetDay, type SepaEntry } from "@/lib/adapters/sepa";
import { creditorIdValid, ibanValid, bicValid, normalizeIban } from "@/lib/sepa-validate";
import { openCharges } from "@/server/charge-ledger";
import { asActor } from "@/server/ledger";

// nexrees: rewritten (see src/lib/adapters/sepa.ts). What is collected: for each active mandate,
// the open amount of the charges of the debtor's leases that fall due in the 35 days up to the
// collection date and have no dunning notice yet. Older arrears are not swept into a direct debit
// (they need their own pre-notification and are handled by dunning).
// ?date=YYYY-MM-DD sets the collection date (default: earliest possible, two TARGET days ahead).

const WINDOW_DAYS = 35;

function problem(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(req: Request) {
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
  if (!tenant || !creditorIdValid(creditorId) || !ibanValid(creditorIban) || (creditorBic && !bicValid(creditorBic))) {
    return problem(422, "SEPA-Lastschrift: Gläubiger-ID und Gläubiger-IBAN fehlen oder sind ungültig. Bitte unter Einstellungen → Buchhaltung eintragen.");
  }

  const earliest = earliestCollectionDate(new Date());
  const raw = new URL(req.url).searchParams.get("date");
  let collectionDate = earliest;
  if (raw) {
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d < earliest || !isTargetDay(d)) {
      return problem(422, `Einzugsdatum ${raw} ist nicht möglich. Frühestens ${earliest.toISOString().slice(0, 10)} und nur an Bankarbeitstagen.`);
    }
    collectionDate = d;
  }
  const windowStart = new Date(collectionDate.getTime() - WINDOW_DAYS * 86_400_000);

  const mandates = await prisma.sepaMandate.findMany({
    where: { tenantId, active: true },
    select: {
      id: true, mandateRef: true, iban: true, signedDate: true, lastCollectedAt: true,
      person: { select: { firstName: true, lastName: true, renters: { select: { leaseId: true } } } },
    },
  });

  const open = new Map((await openCharges(tenantId, new Date())).filter((r) => r.dunLevel === 0).map((r) => [r.id, r.open]));
  const charges = open.size
    ? await prisma.charge.findMany({
        where: { tenantId, id: { in: [...open.keys()] }, dueDate: { gte: windowStart, lte: collectionDate }, leaseId: { not: null } },
        select: { id: true, leaseId: true, period: true, type: true },
      })
    : [];
  const byLease = new Map<string, typeof charges>();
  for (const c of charges) byLease.set(c.leaseId!, [...(byLease.get(c.leaseId!) ?? []), c]);

  const msgId = `NR${tenantId.slice(-8)}${Date.now().toString(36)}`.toUpperCase();
  const entries: SepaEntry[] = [];
  const invalid: string[] = [];
  const used: string[] = [];
  const seenLeases = new Set<string>();
  for (const m of mandates) {
    // one lease is collected through one mandate only, even if several renters have one
    const leases = m.person.renters.map((r) => r.leaseId).filter((id) => !seenLeases.has(id));
    const items = leases.flatMap((id) => byLease.get(id) ?? []);
    const amount = Math.round(items.reduce((a, c) => a + (open.get(c.id) ?? 0), 0) * 100) / 100;
    if (amount <= 0) continue;
    const iban = normalizeIban(m.iban);
    if (!ibanValid(iban)) {
      invalid.push(`${m.mandateRef} (${m.person.firstName} ${m.person.lastName}): IBAN ungültig`);
      continue;
    }
    leases.forEach((id) => seenLeases.add(id));
    const periods = [...new Set(items.map((c) => `${String(c.period.getUTCMonth() + 1).padStart(2, "0")}/${c.period.getUTCFullYear()}`))];
    entries.push({
      mandateRef: m.mandateRef,
      mandateSignedAt: m.signedDate,
      sequence: m.lastCollectedAt ? "RCUR" : "FRST",
      iban,
      debtorName: `${m.person.firstName} ${m.person.lastName}`.trim(),
      amount,
      reference: `${tenant.name} ${periods.join(" ")} Mandat ${m.mandateRef}`,
      endToEndId: `${msgId}-${entries.length + 1}`,
    });
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

  // Mandates used once are RCUR from now on (since the 2016 EPC rulebook a first debit may be
  // RCUR too, so a file that is never submitted does no harm). Journaled with the user.
  await asActor({ id: session.user.id, name: session.user.name ?? session.user.email ?? null, source: "ui" }, (tx) =>
    tx.sepaMandate.updateMany({ where: { id: { in: used }, lastCollectedAt: null }, data: { lastCollectedAt: new Date() } }),
  );

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="sepa-lastschrift-${collectionDate.toISOString().slice(0, 10)}.xml"`,
      "Cache-Control": "no-store",
    },
  });
}
