"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { costEntrySchema, type ActionState, invalid } from "@/lib/schemas";
import { subcommunityValid } from "@/server/weg";
import { bookAs } from "@/server/ledger";
import { costEntryProblem } from "@/lib/betrkv";

export async function createCost(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = costEntrySchema.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  const prop = await prisma.property.findFirst({
    where: { id: r.data.propertyId, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!prop) return { error: "Objekt nicht gefunden" };
  const rule = costEntryProblem(r.data); // nexrees: BetrKV / HeizkostenV
  if (rule) return { error: rule };
  if (!(await subcommunityValid(user.tenantId, r.data.propertyId, r.data.subcommunityId))) {
    return { error: "Untergemeinschaft nicht gefunden" };
  }
  // nexrees: refused for a closed year (Festschreibung)
  const locked = await bookAs(user, (tx) => tx.costEntry.create({ data: { ...r.data, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
  return { ok: true };
}

// nexrees: deletion only in an open period; the database journals the full record (GoBD).
export async function deleteCost(fd: FormData): Promise<void | { error: string }> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const locked = await bookAs(user, (tx) => tx.costEntry.deleteMany({ where: { id, tenantId: user.tenantId } }));
  if (locked) return locked;
  revalidatePath("/", "layout");
}
