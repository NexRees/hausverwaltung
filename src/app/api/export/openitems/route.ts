import { auth } from "@/auth";
import { forbidden, isStaffRole } from "@/lib/staff-access";
import { actingTenantId } from "@/lib/acting-tenant";
import { prisma } from "@/lib/prisma";
import { openCharges } from "@/server/charge-ledger";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!isStaffRole(session.user.role)) return forbidden(); // nexrees: staff only

  const tenantId = await actingTenantId(session.user);
  // nexrees: pre-filter to charges with money open (Postgres), instead of loading every charge
  const openIds = (await openCharges(tenantId)).map((c) => c.id);
  const charges = await prisma.charge.findMany({
    where: { tenantId, id: { in: openIds } },
    include: {
      payments: { select: { amount: true } },
      lease: { include: { unit: { include: { building: { include: { property: true } } } } } },
    },
    orderBy: { dueDate: "asc" },
  });

  const rows = charges
    .map((c) => {
      const open = Number(c.amount) - c.payments.reduce((a, p) => a + Number(p.amount), 0);
      return { c, open };
    })
    .filter((x) => x.open > 0.001)
    .map(({ c, open }) => [
      c.lease ? `${c.lease.unit.building.property.name} · ${c.lease.unit.label}` : "",
      c.type,
      c.period.toISOString().slice(0, 10),
      c.dueDate.toISOString().slice(0, 10),
      Number(c.amount).toFixed(2).replace(".", ","),
      open.toFixed(2).replace(".", ","),
    ]);
  return csvResponse("offene-posten.csv", toCsv(["Einheit", "Art", "Zeitraum", "Faellig", "Betrag", "Offen"], rows));
}
