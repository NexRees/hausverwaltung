"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { personSchema, type ActionState, invalid } from "@/lib/schemas";
import { pickCustom } from "@/lib/custom";
import { bookAs } from "@/server/ledger";

export async function createPerson(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const entries = Object.fromEntries(fd);
  const r = personSchema.safeParse(entries);
  if (!r.success) return invalid(r.error);
  await prisma.person.create({ data: { ...r.data, custom: pickCustom(entries), tenantId: user.tenantId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updatePerson(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const entries = Object.fromEntries(fd);
  const r = personSchema.safeParse(entries);
  if (!r.success) return invalid(r.error);
  // Leere Felder im Formular löschen den Wert (undefined würde Prisma ignorieren).
  const data = Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, v ?? null]));
  await prisma.person.updateMany({ where: { id, tenantId: user.tenantId }, data: { ...data, custom: pickCustom(entries) } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// nexrees: through bookAs so the journal names the user for the SEPA mandates deleted with the person
export async function deletePerson(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const locked = await bookAs(user, (tx) =>
    tx.person.deleteMany({
      where: { id: String(fd.get("id") ?? ""), tenantId: user.tenantId },
    }),
  );
  if (locked) return locked;
  revalidatePath("/", "layout");
}
