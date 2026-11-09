// nexrees: human-readable names for records linked from tasks and comments, in one query per type.
import { prisma } from "@/lib/prisma";
import { isCollabEntity, type CollabEntity } from "@/lib/collab";

export type RecordRef = { entity: string | null; entityId: string | null };

export async function recordLabels(tenantId: string, refs: RecordRef[]): Promise<Map<string, string>> {
  const ids: Record<CollabEntity, Set<string>> = { Property: new Set(), Unit: new Set(), Lease: new Set(), Person: new Set() };
  for (const r of refs) if (isCollabEntity(r.entity) && r.entityId) ids[r.entity].add(r.entityId);
  const q = (e: CollabEntity) => ({ tenantId, id: { in: [...ids[e]] } });
  const [props, units, leases, persons] = await Promise.all([
    ids.Property.size ? prisma.property.findMany({ where: q("Property"), select: { id: true, name: true } }) : [],
    ids.Unit.size
      ? prisma.unit.findMany({ where: q("Unit"), select: { id: true, label: true, building: { select: { property: { select: { name: true } } } } } })
      : [],
    ids.Lease.size
      ? prisma.lease.findMany({ where: q("Lease"), select: { id: true, unit: { select: { label: true, building: { select: { property: { select: { name: true } } } } } } } })
      : [],
    ids.Person.size ? prisma.person.findMany({ where: q("Person"), select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const out = new Map<string, string>();
  for (const p of props) out.set(`Property:${p.id}`, p.name);
  for (const u of units) out.set(`Unit:${u.id}`, `${u.building.property.name} · ${u.label}`);
  for (const l of leases) out.set(`Lease:${l.id}`, `${l.unit.building.property.name} · ${l.unit.label}`);
  for (const p of persons) out.set(`Person:${p.id}`, [p.lastName, p.firstName].filter(Boolean).join(", "));
  return out;
}
