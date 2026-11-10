"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { insuranceSchema, propertyTaxSchema, type ActionState, invalid } from "@/lib/schemas";
import { insuranceYearAmount } from "@/lib/insurance";
import { asActor, uiActor } from "@/server/ledger";

async function assertProperty(tenantId: string, propertyId: string) {
  return prisma.property.findFirst({ where: { id: propertyId, tenantId }, select: { id: true } });
}

// Kostenposition je Objekt/Jahr/Typ anlegen oder aktualisieren (kein Doppelbuchen).
async function upsertCost(
  user: { id: string; tenantId: string; name?: string | null; email?: string | null },
  propertyId: string,
  year: number,
  type: "GRUNDSTEUER" | "VERSICHERUNG",
  amount: number,
) {
  const tenantId = user.tenantId;
  const existing = await prisma.costEntry.findFirst({ where: { tenantId, propertyId, year, type } });
  // nexrees: journaled with the acting user
  await asActor(uiActor(user), (tx) =>
    existing
      ? tx.costEntry.update({ where: { id: existing.id }, data: { amount } })
      : tx.costEntry.create({ data: { tenantId, propertyId, year, type, amount, method: "AREA", umlagefaehig: true } }),
  );
}

// Grundsteuer als Kostenposition (BetrKV) buchen — statt separatem Reiter.
export async function bookGrundsteuerAsCost(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const propertyId = String(fd.get("propertyId") ?? "");
  const year = Number(fd.get("year")) || new Date().getFullYear();
  const tax = await prisma.propertyTax.findFirst({ where: { propertyId, tenantId: user.tenantId } });
  if (!tax) return;
  const amount = tax.messbetrag && tax.hebesatz ? (Number(tax.messbetrag) * Number(tax.hebesatz)) / 100 : 0;
  if (amount <= 0) return;
  await upsertCost(user, propertyId, year, "GRUNDSTEUER", Math.round(amount * 100) / 100);
  revalidatePath("/", "layout");
}

// Versicherung als Kostenposition (BetrKV) buchen. Es wird der auf das Kalender-
// jahr entfallende Anteil ALLER Policen des Objekts gebucht (unterjährige Policen
// anteilig), nicht nur der zuletzt geklickten — siehe insuranceYearAmount (#32).
export async function bookInsuranceAsCost(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const year = Number(fd.get("year")) || new Date().getFullYear();
  const ins = await prisma.insurance.findFirst({ where: { id, tenantId: user.tenantId }, select: { propertyId: true } });
  if (!ins) return;
  const policies = await prisma.insurance.findMany({
    where: { tenantId: user.tenantId, propertyId: ins.propertyId },
    select: { premium: true, startDate: true, endDate: true },
  });
  const amount = insuranceYearAmount(
    policies.map((p) => ({ premium: Number(p.premium), startDate: p.startDate, endDate: p.endDate })),
    year,
  );
  if (amount <= 0) return;
  await upsertCost(user, ins.propertyId, year, "VERSICHERUNG", amount);
  revalidatePath("/", "layout");
}

// --- Versicherung ---
export async function createInsurance(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = insuranceSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  if (!(await assertProperty(user.tenantId, r.data.propertyId))) return { error: "Objekt nicht gefunden" };
  await prisma.insurance.create({ data: { ...r.data, tenantId: user.tenantId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteInsurance(fd: FormData): Promise<void> {
  const user = await requireWriter();
  await prisma.insurance.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
}

// --- Grundsteuer (upsert je Objekt) ---
export async function upsertPropertyTax(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = propertyTaxSchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  if (!(await assertProperty(user.tenantId, r.data.propertyId))) return { error: "Objekt nicht gefunden" };
  const { propertyId, ...data } = r.data;
  await prisma.propertyTax.upsert({
    where: { propertyId },
    create: { ...r.data, tenantId: user.tenantId },
    update: data,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePropertyTax(fd: FormData): Promise<void> {
  const user = await requireWriter();
  await prisma.propertyTax.deleteMany({ where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
}
