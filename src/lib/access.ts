// nexrees: single place that answers "who may see which record".
// Today this reproduces the existing rules (same tenant + staff role). Per-user
// property scopes will be filled in here, so every caller (tasks, comments, mention
// pickers) picks them up without changes.
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/rbac";
import { isStaff, STAFF_ROLES, type CollabEntity } from "@/lib/collab";

export type AccessScope = {
  tenantId: string;
  userId: string;
  staff: boolean;
  /** Property ids the user may see; "ALL" = no restriction within the tenant. */
  properties: "ALL" | string[];
};

export async function getAccessScope(user: SessionUser): Promise<AccessScope> {
  return { tenantId: user.tenantId, userId: user.id, staff: isStaff(user.role), properties: "ALL" };
}

/** Owning property of a record, or null for records without one (Person). undefined = not found in tenant. */
export async function propertyOf(tenantId: string, entity: CollabEntity, id: string): Promise<string | null | undefined> {
  switch (entity) {
    case "Property": {
      const p = await prisma.property.findFirst({ where: { id, tenantId }, select: { id: true } });
      return p ? p.id : undefined;
    }
    case "Unit": {
      const u = await prisma.unit.findFirst({ where: { id, tenantId }, select: { building: { select: { propertyId: true } } } });
      return u ? u.building.propertyId : undefined;
    }
    case "Lease": {
      const l = await prisma.lease.findFirst({ where: { id, tenantId }, select: { unit: { select: { building: { select: { propertyId: true } } } } } });
      return l ? l.unit.building.propertyId : undefined;
    }
    case "Person": {
      const p = await prisma.person.findFirst({ where: { id, tenantId }, select: { id: true } });
      return p ? null : undefined;
    }
  }
}

export async function canSeeEntity(scope: AccessScope, entity: CollabEntity, entityId: string): Promise<boolean> {
  if (!scope.staff) return false;
  const propertyId = await propertyOf(scope.tenantId, entity, entityId);
  if (propertyId === undefined) return false;
  if (scope.properties === "ALL" || propertyId === null) return true;
  return scope.properties.includes(propertyId);
}

/** Colleagues who can see a record (for the @mention list and the assignee picker). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- record args used once per-property scopes exist
export async function usersWhoCanSee(tenantId: string, _entity?: CollabEntity, _entityId?: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
