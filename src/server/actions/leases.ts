"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { bookAs } from "@/server/ledger";
import { depositCapProblem } from "@/lib/deposit";
import { pickCustom } from "@/lib/custom";
import {
  leaseCreateSchema,
  leaseUpdateSchema,
  rentComponentSchema,
  rentAdjustmentSchema,
  depositSchema,
  renterSchema,
  type ActionState,
} from "@/lib/schemas";

function fail(msg?: string): ActionState {
  return { error: msg ?? "Ungültige Eingabe" };
}
function done(): ActionState {
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Lease ---
export async function createLease(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const entries = Object.fromEntries(fd);
  const r = leaseCreateSchema.safeParse(entries);
  if (!r.success) return fail(r.error.issues[0]?.message);

  // Mehrere Mieter möglich (personIds als Mehrfachfeld); Duplikate entfernen.
  const personIds = [...new Set(fd.getAll("personIds").map(String).filter(Boolean))];
  if (personIds.length === 0) return fail("Mindestens eine Person wählen");

  const [unit, persons] = await Promise.all([
    prisma.unit.findFirst({ where: { id: r.data.unitId, tenantId: user.tenantId }, select: { id: true } }),
    prisma.person.findMany({ where: { id: { in: personIds }, tenantId: user.tenantId }, select: { id: true } }),
  ]);
  if (!unit) return fail("Einheit nicht gefunden");
  if (persons.length !== personIds.length) return fail("Person nicht gefunden");

  // personId (API-Feld) hier verwerfen — das Web-Formular nutzt personIds.
  const { unitId, personId: _ignored, ...data } = r.data;
  void _ignored;
  await prisma.lease.create({
    data: {
      ...data,
      custom: pickCustom(entries),
      tenantId: user.tenantId,
      unitId,
      renters: { create: personIds.map((personId) => ({ tenantId: user.tenantId, personId })) },
    },
  });
  return done();
}

export async function updateLease(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const r = leaseUpdateSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return fail(r.error.issues[0]?.message);
  // Einheit muss zum Mandanten gehören (Vertrag kann auf andere Einheit umgezogen werden).
  const unit = await prisma.unit.findFirst({
    where: { id: r.data.unitId, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!unit) return fail("Einheit nicht gefunden");
  await prisma.lease.updateMany({
    where: { id, tenantId: user.tenantId },
    data: { ...r.data, custom: pickCustom(Object.fromEntries(fd)) },
  });
  return done();
}

// nexrees: cascades into booked rows; refused with a message when they are in a closed period
export async function deleteLease(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.lease.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}

// nexrees: § 551 Abs. 1 BGB cap for residential deposits
async function depositCap(tenantId: string, leaseId: string, amount: number) {
  const l = await prisma.lease.findFirst({ where: { id: leaseId, tenantId }, select: { rentCold: true, unit: { select: { type: true } } } });
  return l ? depositCapProblem(amount, Number(l.rentCold), l.unit.type) : null;
}

// --- Renter (Mitmieter) ---
async function assertLease(tenantId: string, leaseId: string) {
  return prisma.lease.findFirst({ where: { id: leaseId, tenantId }, select: { id: true } });
}

export async function addRenter(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = renterSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return fail(r.error.issues[0]?.message);
  if (!(await assertLease(user.tenantId, r.data.leaseId))) return fail("Vertrag nicht gefunden");
  await prisma.renter.create({ data: { ...r.data, tenantId: user.tenantId } });
  return done();
}

export async function deleteRenter(fd: FormData): Promise<void> {
  const user = await requireWriter();
  await prisma.renter.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
}

// --- RentComponent ---
export async function createComponent(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = rentComponentSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return fail(r.error.issues[0]?.message);
  if (!(await assertLease(user.tenantId, r.data.leaseId))) return fail("Vertrag nicht gefunden");
  await prisma.rentComponent.create({ data: { ...r.data, tenantId: user.tenantId } });
  return done();
}

export async function deleteComponent(fd: FormData): Promise<void> {
  const user = await requireWriter();
  await prisma.rentComponent.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
}

// --- RentAdjustment ---
export async function createAdjustment(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = rentAdjustmentSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return fail(r.error.issues[0]?.message);
  if (!(await assertLease(user.tenantId, r.data.leaseId))) return fail("Vertrag nicht gefunden");
  await prisma.rentAdjustment.create({ data: { ...r.data, tenantId: user.tenantId } });
  return done();
}

// Anpassung anwenden: setzt Kaltmiete des Vertrags auf newRentCold.
export async function applyAdjustment(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const adj = await prisma.rentAdjustment.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { lease: { select: { id: true, tenantId: true } } },
  });
  if (adj && adj.lease.tenantId === user.tenantId) {
    await prisma.$transaction([
      prisma.lease.update({ where: { id: adj.leaseId }, data: { rentCold: adj.newRentCold } }),
      prisma.rentAdjustment.update({ where: { id: adj.id }, data: { applied: true } }),
    ]);
  }
  revalidatePath("/", "layout");
}

export async function deleteAdjustment(fd: FormData): Promise<void> {
  const user = await requireWriter();
  await prisma.rentAdjustment.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
}

// --- Deposit ---
export async function upsertDeposit(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = depositSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return fail(r.error.issues[0]?.message);
  if (!(await assertLease(user.tenantId, r.data.leaseId))) return fail("Vertrag nicht gefunden");
  const capProblem = await depositCap(user.tenantId, r.data.leaseId, Number(r.data.amount)); // nexrees: § 551 BGB
  if (capProblem) return fail(capProblem);
  const { leaseId, accountId, ...rest } = r.data;
  const data = { ...rest, accountId: accountId || null };
  await prisma.deposit.upsert({
    where: { leaseId },
    create: { ...data, leaseId, tenantId: user.tenantId },
    update: data,
  });
  return done();
}

// nexrees: journaled with the acting user (the database keeps the deleted record)
export async function deleteDeposit(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.deposit.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}
