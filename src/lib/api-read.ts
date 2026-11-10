// nexrees: single-record reads for GET /api/v1/records/{entity}/{id} and the MCP `get_record`
// tool. Every entity has an explicit field whitelist (Prisma `select`), so new columns never leak
// by accident: no password hashes, token hashes, storage keys or tenant mail/AI secrets. Always
// scoped to the token's company (tenantId). Related records come with their ids.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeStatus } from "@/server/charge-ledger";
import { appHref, apiHref } from "@/lib/search";

const named = { select: { id: true, name: true } } as const;
const personName = { select: { id: true, firstName: true, lastName: true } } as const;
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const unitRef = {
  select: { id: true, label: true, buildingId: true, building: { select: { propertyId: true, property: named } } },
} as const;

/** Decimal → number, Date → ISO string, recursively (JSON-friendly, like the lists). */
export function plain(v: unknown): unknown {
  if (v == null) return v;
  if (Prisma.Decimal.isDecimal(v)) return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

type Row = Record<string, unknown> | null;
type Reader = (tenantId: string, id: string) => Promise<Row>;

const READERS: Record<string, Reader> = {
  property: (tenantId, id) =>
    prisma.property.findFirst({
      where: { id, tenantId },
      select: {
        id: true, name: true, street: true, zip: true, city: true, type: true, management: true, meaTotal: true,
        feeType: true, feeValue: true, areaModel: true, totalArea: true, custom: true, createdAt: true,
        buildings: { select: { id: true, name: true, _count: { select: { units: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        subcommunities: { select: { id: true, name: true } },
        propertyTax: { select: { id: true } },
        _count: { select: { tickets: true, meetings: true, documents: true, insurances: true } },
      },
    }),
  building: (tenantId, id) =>
    prisma.building.findFirst({
      where: { id, tenantId },
      select: {
        id: true, name: true, propertyId: true, property: named, createdAt: true,
        units: { select: { id: true, label: true, type: true }, orderBy: [{ label: "asc" }, { id: "asc" }], take: 500 },
        _count: { select: { units: true } },
      },
    }),
  unit: async (tenantId, id) => {
    const u = await prisma.unit.findFirst({
      where: { id, tenantId },
      select: {
        id: true, label: true, type: true, area: true, rooms: true, mea: true, custom: true, createdAt: true,
        buildingId: true, subcommunityId: true,
        building: { select: { name: true, propertyId: true, property: named } },
        leases: {
          select: { id: true, startDate: true, endDate: true, rentCold: true, renters: { select: { person: personName } } },
          orderBy: [{ startDate: "desc" }, { id: "asc" }],
        },
        owners: { select: { id: true, share: true, person: personName } },
        meters: { select: { id: true, type: true, serialNo: true } },
      },
    });
    if (!u) return null;
    const now = new Date();
    const current = u.leases.find((l) => l.startDate <= now && (!l.endDate || l.endDate >= now));
    return {
      ...u,
      propertyId: u.building.propertyId,
      currentLeaseId: current?.id ?? null,
      leases: u.leases.map(({ renters, ...l }) => ({ ...l, renters: renters.map((r) => ({ id: r.person.id, name: fullName(r.person) })) })),
      owners: u.owners.map((o) => ({ id: o.id, share: o.share, personId: o.person.id, name: fullName(o.person) })),
    };
  },
  person: async (tenantId, id) => {
    const p = await prisma.person.findFirst({
      where: { id, tenantId },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, type: true, note: true,
        iban: true, accountHolder: true, address: true, custom: true, createdAt: true,
        renters: { select: { lease: { select: { id: true, startDate: true, endDate: true, unit: unitRef } } } },
        owners: { select: { id: true, share: true, unit: unitRef } },
        _count: { select: { documents: true } },
      },
    });
    if (!p) return null;
    const { renters, owners, ...rest } = p;
    return {
      ...rest,
      leases: renters.map((r) => r.lease),
      ownerships: owners,
      leaseIds: renters.map((r) => r.lease.id),
    };
  },
  lease: async (tenantId, id) => {
    const l = await prisma.lease.findFirst({
      where: { id, tenantId },
      select: {
        id: true, unitId: true, startDate: true, endDate: true, rentCold: true, personCount: true, noticePeriodM: true,
        custom: true, createdAt: true,
        unit: unitRef,
        renters: { select: { person: personName } },
        components: { select: { id: true, type: true, amount: true, note: true } },
        adjustments: { select: { id: true, type: true, effectiveDate: true, newRentCold: true, applied: true, note: true } },
        deposit: { select: { id: true, type: true, amount: true, accountId: true, interestRate: true, receivedDate: true, returnedDate: true } },
        _count: { select: { charges: true } },
      },
    });
    if (!l) return null;
    return {
      ...l,
      propertyId: l.unit.building.propertyId,
      renters: l.renters.map((r) => ({ id: r.person.id, name: fullName(r.person) })),
      personIds: l.renters.map((r) => r.person.id),
    };
  },
  ticket: (tenantId, id) =>
    prisma.ticket.findFirst({
      where: { id, tenantId },
      select: {
        id: true, title: true, description: true, category: true, status: true, priority: true, dueDate: true,
        reminderDate: true, timeSpentMin: true, createdAt: true,
        propertyId: true, property: named, unitId: true, unit: { select: { id: true, label: true } },
        contractorId: true, contractor: { select: { id: true, name: true, trade: true } },
        assigneeId: true, assignee: named, reporterId: true, reporter: named,
      },
    }),
  task: (tenantId, id) =>
    prisma.task.findFirst({
      where: { id, tenantId },
      select: {
        id: true, title: true, description: true, dueDate: true, done: true, doneAt: true, createdAt: true,
        assigneeId: true, assignee: named, createdById: true, createdBy: named, entity: true, entityId: true, propertyId: true,
      },
    }),
  contractor: (tenantId, id) =>
    prisma.contractor.findFirst({
      where: { id, tenantId },
      select: {
        id: true, name: true, trade: true, email: true, phone: true, createdAt: true,
        contracts: { select: { id: true, title: true, nextDue: true, propertyId: true } },
        _count: { select: { tickets: true } },
      },
    }),
  // metadata only: no storageKey (internal file path), no file content
  document: (tenantId, id) =>
    prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        id: true, name: true, category: true, mime: true, size: true, eInvoice: true, invoiceNo: true, invoiceTotal: true,
        createdAt: true, propertyId: true, property: named, unitId: true, unit: { select: { id: true, label: true } },
        personId: true, person: personName,
      },
    }),
  meeting: (tenantId, id) =>
    prisma.meeting.findFirst({
      where: { id, tenantId },
      select: {
        id: true, title: true, date: true, location: true, status: true, protocol: true, createdAt: true,
        propertyId: true, property: named,
        agendaItems: { select: { id: true, position: true, title: true, description: true }, orderBy: { position: "asc" } },
        resolutions: { select: { id: true, number: true, title: true, result: true }, orderBy: { number: "asc" } },
      },
    }),
  charge: async (tenantId, id) => {
    const c = await prisma.charge.findFirst({
      where: { id, tenantId },
      select: {
        id: true, type: true, period: true, dueDate: true, amount: true, description: true, createdAt: true,
        leaseId: true, areaAllocationId: true,
        lease: { select: { unit: unitRef } },
        payments: { select: { id: true, date: true, amount: true, direction: true, accountId: true }, orderBy: { date: "asc" } },
        dunnings: { select: { id: true, level: true, date: true, fee: true }, orderBy: { date: "asc" } },
      },
    });
    if (!c) return null;
    const paid = c.payments.reduce((s, p) => s + Number(p.amount), 0);
    const { lease, ...rest } = c;
    return {
      ...rest,
      paid: Math.round(paid * 100) / 100,
      open: Math.round((Number(c.amount) - paid) * 100) / 100,
      status: chargeStatus(Number(c.amount), paid, c.dueDate, new Date()),
      unitId: lease?.unit.id ?? null,
      unit: lease?.unit ?? null,
      propertyId: lease?.unit.building.propertyId ?? null,
    };
  },
  payment: (tenantId, id) =>
    prisma.payment.findFirst({
      where: { id, tenantId },
      select: {
        id: true, date: true, amount: true, direction: true, reference: true, counterparty: true, counterpartyIban: true,
        note: true, createdAt: true, accountId: true, account: named, chargeId: true,
        charge: { select: { id: true, type: true, period: true, leaseId: true } },
        documents: { select: { id: true, name: true } },
      },
    }),
  owner: async (tenantId, id) => {
    const o = await prisma.owner.findFirst({
      where: { id, tenantId },
      select: { id: true, share: true, personId: true, person: personName, unitId: true, unit: unitRef },
    });
    return o ? { ...o, propertyId: o.unit.building.propertyId } : null;
  },
  appointment: (tenantId, id) =>
    prisma.appointment.findFirst({
      where: { id, tenantId },
      select: {
        id: true, title: true, type: true, start: true, end: true, location: true, note: true, createdAt: true,
        propertyId: true, property: named, persons: personName, documents: { select: { id: true, name: true } },
      },
    }),
  insurance: (tenantId, id) =>
    prisma.insurance.findFirst({
      where: { id, tenantId },
      select: {
        id: true, type: true, insurer: true, policyNo: true, premium: true, startDate: true, endDate: true, note: true,
        createdAt: true, propertyId: true, property: named,
      },
    }),
  account: (tenantId, id) =>
    prisma.account.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, type: true, iban: true, balance: true, balanceAt: true, createdAt: true },
    }),
  meter: (tenantId, id) =>
    prisma.meter.findFirst({
      where: { id, tenantId },
      select: {
        id: true, type: true, serialNo: true, createdAt: true, unitId: true, unit: unitRef,
        readings: { select: { id: true, date: true, value: true }, orderBy: { date: "desc" }, take: 24 },
      },
    }),
  resolution: (tenantId, id) =>
    prisma.resolution.findFirst({
      where: { id, tenantId },
      select: {
        id: true, number: true, title: true, text: true, date: true, result: true, votesYes: true, votesNo: true,
        votesAbstain: true, createdAt: true, propertyId: true, property: named, meetingId: true, subcommunityId: true,
      },
    }),
};

const ALIASES: Record<string, string> = { ownership: "owner" };

/** Entities with a single-record read. */
export const READ_ENTITIES = [...Object.keys(READERS), ...Object.keys(ALIASES)];

export class UnknownEntityError extends Error {
  readonly status = 404;
  readonly code = "unknown_entity";
  constructor(entity: string) {
    super(`Unbekannte Entität: ${entity}. Lesbar: ${READ_ENTITIES.join(", ")}`);
  }
}

/**
 * One record of the company, or null. Throws UnknownEntityError for an entity without a reader.
 * Adds `href` (staff app path, where one exists) and `apiHref`.
 */
export async function readRecord(tenantId: string, entity: string, id: string): Promise<Record<string, unknown> | null> {
  const key = ALIASES[entity] ?? entity;
  const reader = Object.hasOwn(READERS, key) ? READERS[key] : undefined;
  if (!reader) throw new UnknownEntityError(entity);
  if (!id) return null;
  const row = await reader(tenantId, id);
  if (!row) return null;
  return {
    ...(plain(row) as Record<string, unknown>),
    href: appHref(key, id, typeof row.title === "string" ? row.title : undefined),
    apiHref: apiHref(key, id),
  };
}
