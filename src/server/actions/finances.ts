"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole, requireWriter, WRITE_ROLES } from "@/lib/rbac";
import {
  accountSchema,
  chargeSchema,
  paymentSchema,
  mandateSchema,
  generateSchema,
  type ActionState,
  invalid,
} from "@/lib/schemas";
import { parseCamt053 } from "@/lib/adapters/bankImport";
import { ensureDefaultAccounts } from "@/lib/accounts";
import { generateAreaCharges } from "@/lib/api-ops";
import { audit } from "@/lib/audit";
import { saveFile } from "@/lib/storage";
import { money } from "@/lib/format";
import { dunningFor } from "@/server/dunning";
import { queueEmails } from "@/server/outbox";
import { bookAs, closedPeriodProblem, uiActor } from "@/server/ledger";
import { importCamtEntries, camtSummary } from "@/lib/bank-import";

// Standard-Kontenrahmen für den Mandanten anlegen (idempotent).
export async function seedDefaultAccounts(): Promise<void> {
  const user = await requireWriter();
  await ensureDefaultAccounts(prisma, user.tenantId);
  revalidatePath("/", "layout");
}

function fail(msg?: string): ActionState {
  return { error: msg ?? "Ungültige Eingabe" };
}
function done(): ActionState {
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Account ---
export async function createAccount(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = accountSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  await prisma.account.create({ data: { ...r.data, tenantId: user.tenantId } });
  return done();
}
export async function updateAccount(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const r = accountSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  const acc = await prisma.account.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true } });
  if (!acc) return fail("Konto nicht gefunden");
  await prisma.account.update({ where: { id: acc.id }, data: { name: r.data.name, type: r.data.type, iban: r.data.iban ?? null } });
  return done();
}
// nexrees: cascades into booked rows; refused with a message when they are in a closed period
export async function deleteAccount(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.account.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}

// --- Charge (manuell) ---
export async function createCharge(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = chargeSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  // nexrees: through bookAs so a closed period (Festschreibung) is refused with a clear message
  const locked = await bookAs(user, (tx) => tx.charge.create({ data: { ...r.data, tenantId: user.tenantId } }));
  return locked ?? done();
}
// nexrees: deletion only in an open period; the database journals the full record (GoBD).
export async function deleteCharge(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.charge.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}

// --- Sollstellungslauf: Miete für aktive Verträge eines Monats ---
export async function generateCharges(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = generateSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  const [y, m] = r.data.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const due = new Date(Date.UTC(y, m - 1, 3));
  const closed = await closedPeriodProblem(user.tenantId, first, "Sollstellungslauf"); // nexrees
  if (closed) return fail(closed);

  const leases = await prisma.lease.findMany({
    where: {
      tenantId: user.tenantId,
      startDate: { lte: last },
      OR: [{ endDate: null }, { endDate: { gte: first } }],
    },
    include: { components: { select: { amount: true } }, charges: { where: { period: first, type: "MIETE" }, select: { id: true } } },
  });

  // nexrees: one batched insert instead of one round trip per lease (2,000+ leases).
  const data = leases
    .filter((l) => l.charges.length === 0) // schon vorhanden
    .map((l) => ({
      tenantId: user.tenantId,
      leaseId: l.id,
      type: "MIETE" as const,
      period: first,
      dueDate: due,
      amount: Number(l.rentCold) + l.components.reduce((a, c) => a + Number(c.amount), 0),
    }));
  let created = data.length ? (await prisma.charge.createMany({ data })).count : 0;
  created += await generateAreaCharges(user.tenantId, first, due, last);
  revalidatePath("/", "layout");
  return { ok: true, error: created === 0 ? "Keine neuen Sollstellungen (bereits vorhanden)" : undefined };
}

// --- Payment ---
export async function createPayment(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = paymentSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  // Zugehörigkeit prüfen (Charge/Account des Mandanten)
  if (r.data.chargeId) {
    const c = await prisma.charge.findFirst({ where: { id: r.data.chargeId, tenantId: user.tenantId }, select: { id: true } });
    if (!c) return fail("Sollstellung nicht gefunden");
  }
  const locked = await bookAs(user, (tx) => tx.payment.create({ data: { ...r.data, tenantId: user.tenantId } })); // nexrees
  return locked ?? done();
}
// nexrees: deletion only in an open period; the database journals the full record (GoBD).
export async function deletePayment(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.payment.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}

// Kontobewegung: Notiz + verknüpfte Belege/Dokumente setzen (#23).
export async function updatePaymentDetails(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  const documentIds = [...new Set(fd.getAll("documentIds").map(String).filter(Boolean))];

  const payment = await prisma.payment.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true } });
  if (!payment) return fail("Buchung nicht gefunden");
  if (documentIds.length) {
    const cnt = await prisma.document.count({ where: { tenantId: user.tenantId, id: { in: documentIds } } });
    if (cnt !== documentIds.length) return fail("Dokument nicht gefunden");
  }

  // nexrees: journaled with the acting user; the note stays editable after a close
  const locked = await bookAs(user, (tx) =>
    tx.payment.update({
      where: { id: payment.id },
      data: { note, documents: { set: documentIds.map((docId) => ({ id: docId })) } },
    }),
  );
  return locked ?? done();
}

// --- SEPA-Mandat ---
export async function createMandate(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = mandateSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  const p = await prisma.person.findFirst({ where: { id: r.data.personId, tenantId: user.tenantId }, select: { id: true } });
  if (!p) return fail("Person nicht gefunden");
  await prisma.sepaMandate.create({ data: { ...r.data, tenantId: user.tenantId } });
  return done();
}
// nexrees: journaled with the acting user (the database keeps the deleted mandate)
export async function deleteMandate(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const locked = await bookAs(user, (tx) => tx.sepaMandate.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}

// --- camt.053 Bankimport mit naivem Auto-Matching ---
export async function importCamt(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Keine Datei");
  const accountId = String(fd.get("accountId") ?? "") || null;

  let entries;
  try {
    entries = parseCamt053(await file.text());
  } catch {
    return fail("camt.053 konnte nicht gelesen werden");
  }
  if (entries.length === 0) return fail("Keine Buchungen in der Datei");

  if (accountId && !(await prisma.account.findFirst({ where: { id: accountId, tenantId: user.tenantId }, select: { id: true } }))) {
    return fail("Konto nicht gefunden");
  }
  // nexrees: one transaction, dedup, entries in the closed period reported instead of aborting
  const res = await importCamtEntries(user.tenantId, accountId, entries, uiActor(user));
  revalidatePath("/", "layout");
  return { ok: true, error: camtSummary(res) };
}

// --- Mahnung: nächste Stufe für überfällige Sollstellung ---
const DUNNING_FEE: Record<number, number> = { 1: 0, 2: 5, 3: 10 };
const DUNNING_MIN_DAYS = 14; // Mindestabstand zwischen zwei Mahnstufen
export async function createDunning(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const chargeId = String(fd.get("chargeId") ?? "");
  const charge = await prisma.charge.findFirst({
    where: { id: chargeId, tenantId: user.tenantId },
    include: { dunnings: { orderBy: { date: "desc" }, take: 1 } },
  });
  if (!charge) return fail("Sollstellung nicht gefunden");

  // Nächste Stufe erst nach Ablauf der Frist seit der letzten Mahnung.
  const last = charge.dunnings[0];
  if (last) {
    const days = Math.floor((Date.now() - last.date.getTime()) / 86_400_000);
    if (days < DUNNING_MIN_DAYS) {
      const remaining = DUNNING_MIN_DAYS - days;
      return {
        error: `Letzte Mahnung vor ${days} Tag(en) erstellt. Nächste Mahnstufe frühestens in ${remaining} Tag(en) möglich.`,
      };
    }
  }

  const level = Math.min((last?.level ?? 0) + 1, 3);
  await prisma.dunningNotice.create({
    data: { tenantId: user.tenantId, chargeId, level, fee: DUNNING_FEE[level] ?? 0 },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Mahnung als PDF an den Mieter mailen (Entwurf im Postausgang) + Ablage ---
export async function emailDunning(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const chargeId = String(fd.get("chargeId") ?? "");
  const res = await dunningFor(user.tenantId, chargeId);
  if (!res) return fail("Sollstellung nicht gefunden");
  const { lease, property, renter, total } = res;
  if (!renter?.email) return fail("Kein Mieter mit E-Mail-Adresse hinterlegt.");
  const title = res.doc.title;
  const pdf = res.pdf();
  const name = `${title} - ${lease.unit.label}.pdf`;
  const storageKey = await saveFile(pdf, name);
  const doc = await prisma.document.create({
    data: {
      tenantId: user.tenantId,
      propertyId: property.id,
      name,
      category: "SONSTIGES",
      mime: "application/pdf",
      size: pdf.length,
      storageKey,
    },
  });
  const msg = await prisma.emailMessage.create({
    data: {
      tenantId: user.tenantId,
      toAddress: renter.email,
      subject: `${title} · ${property.name}`,
      body: `Sehr geehrte/r ${renter.firstName} ${renter.lastName},\n\nanbei ${title.toLowerCase()} über ${money(total)}.\n\nMit freundlichen Grüßen\n${property.tenant.name}`,
      status: "ENTWURF",
      attachments: { create: [{ documentId: doc.id }] },
    },
  });
  await audit(user, "CREATE", "EmailMessage", msg.id, `${title} ${lease.unit.label}`);
  const notice = await queueEmails(user.tenantId, [msg.id], user);
  revalidatePath("/", "layout");
  return { ok: true, notice };
}

// nexrees: cancel a SEPA direct-debit file that was never submitted to the bank, so its charges
// can be collected in a new file. A submitted file must not be cancelled (double debit).
export async function cancelSepaCollection(fd: FormData): Promise<void | { error: string }> {
  const user = await requireRole(WRITE_ROLES);
  const id = String(fd.get("id") ?? "");
  const res = await prisma.sepaCollection.updateMany({
    where: { id, tenantId: user.tenantId, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelledByName: user.name ?? user.email ?? null },
  });
  if (res.count === 0) return { error: "Datei nicht gefunden oder bereits storniert." };
  await audit(user, "UPDATE", "SepaCollection", id, "SEPA-Lastschriftdatei storniert (nicht eingereicht)");
  revalidatePath("/", "layout");
}
