import type { Prisma, PersonType, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeLedgerPage, chargeStatus, type ChargeStatus } from "@/server/charge-ledger";
import { tokenizedWhere, SEARCH_FIELDS } from "@/lib/search";
import { MAX_OFFSET } from "@/lib/api-http";

// Geteilte, mandanten-gescopte Datenschicht für REST-API und MCP-Server.
// Alle Funktionen erhalten die tenantId aus dem authentifizierten Token.
// nexrees: every list is paged ({ limit, offset }, at most LIST_CEILING rows) and returns
// { items, total }; some take a free-text `q` (every word must match) and key filters. Rows carry
// the ids of related records (propertyId, unitId, leaseId, …) next to the display names.

const num = (d: unknown) => (d == null ? null : Number(d as number));
const round2 = (n: number) => Math.round(n * 100) / 100;

export const LIST_CEILING = 5000;
export type ListOpts = { limit?: number; offset?: number; q?: string };
export type ListPage<T> = { items: T[]; total: number };
const pg = (o: ListOpts) => ({
  skip: Math.min(MAX_OFFSET, Math.max(0, Math.floor(o.offset ?? 0))),
  take: Math.min(LIST_CEILING, Math.max(0, Math.floor(o.limit ?? LIST_CEILING))),
});
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

export async function listProperties(tenantId: string, o: ListOpts = {}) {
  const where: Prisma.PropertyWhereInput = { tenantId, ...tokenizedWhere<Prisma.PropertyWhereInput>(o.q, SEARCH_FIELDS.property) };
  const [rows, total] = await Promise.all([
    prisma.property.findMany({
      where,
      include: { buildings: { include: { _count: { select: { units: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.property.count({ where }),
  ]);
  const items = rows.map((p) => ({
    id: p.id,
    name: p.name,
    street: p.street,
    zip: p.zip,
    city: p.city,
    type: p.type,
    management: p.management,
    units: p.buildings.reduce((a, b) => a + b._count.units, 0),
    buildingIds: p.buildings.map((b) => b.id),
  }));
  return { items, total };
}

export async function getProperty(tenantId: string, id: string) {
  const p = await prisma.property.findFirst({
    where: { id, tenantId },
    include: { buildings: { include: { units: true } } },
  });
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    street: p.street,
    zip: p.zip,
    city: p.city,
    type: p.type,
    management: p.management,
    meaTotal: p.meaTotal,
    buildings: p.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      units: b.units.map((u) => ({ id: u.id, label: u.label, type: u.type, area: num(u.area), mea: u.mea })),
    })),
  };
}

export async function listUnits(tenantId: string, o: ListOpts & { propertyId?: string } = {}) {
  const where: Prisma.UnitWhereInput = {
    tenantId,
    ...(o.propertyId ? { building: { propertyId: o.propertyId } } : {}),
    ...tokenizedWhere<Prisma.UnitWhereInput>(o.q, SEARCH_FIELDS.unit),
  };
  const [rows, total] = await Promise.all([
    prisma.unit.findMany({
      where,
      include: { building: { select: { name: true, propertyId: true, property: { select: { name: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.unit.count({ where }),
  ]);
  const items = rows.map((u) => ({
    id: u.id,
    label: u.label,
    type: u.type,
    area: num(u.area),
    rooms: num(u.rooms),
    mea: u.mea,
    property: u.building.property.name,
    building: u.building.name,
    propertyId: u.building.propertyId,
    buildingId: u.buildingId,
  }));
  return { items, total };
}

export async function listPersons(tenantId: string, o: ListOpts & { type?: PersonType } = {}) {
  const where: Prisma.PersonWhereInput = {
    tenantId,
    ...(o.type ? { type: o.type } : {}),
    ...tokenizedWhere<Prisma.PersonWhereInput>(o.q, SEARCH_FIELDS.person),
  };
  const [rows, total] = await Promise.all([
    prisma.person.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], ...pg(o) }),
    prisma.person.count({ where }),
  ]);
  const items = rows.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    type: p.type,
  }));
  return { items, total };
}

export async function listLeases(
  tenantId: string,
  o: ListOpts & { unitId?: string; propertyId?: string; personId?: string; active?: boolean } = {},
) {
  const now = new Date();
  const where: Prisma.LeaseWhereInput = {
    tenantId,
    ...(o.unitId ? { unitId: o.unitId } : {}),
    ...(o.propertyId ? { unit: { building: { propertyId: o.propertyId } } } : {}),
    ...(o.personId ? { renters: { some: { personId: o.personId } } } : {}),
    ...(o.active === true ? { startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] } : {}),
    ...(o.active === false ? { OR: [{ startDate: { gt: now } }, { endDate: { lt: now } }] } : {}),
    ...tokenizedWhere<Prisma.LeaseWhereInput>(o.q, SEARCH_FIELDS.lease),
  };
  const [rows, total] = await Promise.all([
    prisma.lease.findMany({
      where,
      include: {
        unit: { select: { label: true, buildingId: true, building: { select: { propertyId: true, property: { select: { name: true } } } } } },
        renters: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.lease.count({ where }),
  ]);
  const items = rows.map((l) => ({
    id: l.id,
    property: l.unit.building.property.name,
    unit: l.unit.label,
    tenants: l.renters.map((r) => fullName(r.person)),
    rentCold: num(l.rentCold),
    startDate: l.startDate.toISOString().slice(0, 10),
    endDate: l.endDate ? l.endDate.toISOString().slice(0, 10) : null,
    unitId: l.unitId,
    buildingId: l.unit.buildingId,
    propertyId: l.unit.building.propertyId,
    renters: l.renters.map((r) => ({ id: r.personId, name: fullName(r.person) })),
    personIds: l.renters.map((r) => r.personId),
  }));
  return { items, total };
}

export async function listTickets(
  tenantId: string,
  o: ListOpts & { status?: TicketStatus; propertyId?: string; unitId?: string } = {},
) {
  const where: Prisma.TicketWhereInput = {
    tenantId,
    ...(o.status ? { status: o.status } : {}),
    ...(o.propertyId ? { propertyId: o.propertyId } : {}),
    ...(o.unitId ? { unitId: o.unitId } : {}),
    ...tokenizedWhere<Prisma.TicketWhereInput>(o.q, SEARCH_FIELDS.ticket),
  };
  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        property: { select: { name: true } },
        unit: { select: { label: true } },
        contractor: { select: { name: true } },
        assignee: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.ticket.count({ where }),
  ]);
  const items = rows.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    status: t.status,
    priority: t.priority,
    property: t.property?.name ?? null,
    assignee: t.assignee?.name ?? null,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    propertyId: t.propertyId,
    unitId: t.unitId,
    unit: t.unit?.label ?? null,
    contractorId: t.contractorId,
    contractor: t.contractor?.name ?? null,
    assigneeId: t.assigneeId,
  }));
  return { items, total };
}

// Charge details for the rows of a ledger page (one query for the page, not for the company).
async function chargeDetails(tenantId: string, ids: string[]) {
  const rows = await prisma.charge.findMany({
    where: { tenantId, id: { in: ids } },
    select: {
      id: true,
      type: true,
      period: true,
      dueDate: true,
      amount: true,
      description: true,
      leaseId: true,
      lease: { select: { unitId: true, unit: { select: { label: true, building: { select: { propertyId: true, property: { select: { name: true } } } } } } } },
    },
  });
  return new Map(rows.map((r) => [r.id, r]));
}
type ChargeDetail = Awaited<ReturnType<typeof chargeDetails>> extends Map<string, infer V> ? V : never;

export async function listOpenItems(tenantId: string, o: ListOpts & { leaseId?: string; overdue?: boolean } = {}) {
  // nexrees: open/overdue and the page are computed in Postgres (charge-ledger); details only for the page
  const { skip, take } = pg(o);
  const ledger = await chargeLedgerPage(tenantId, { status: o.overdue ? "OVERDUE" : "UNPAID", leaseId: o.leaseId }, skip, take);
  const details = await chargeDetails(tenantId, ledger.rows.map((r) => r.id));
  const items = ledger.rows.flatMap((r) => {
    const c = details.get(r.id);
    if (!c) return [];
    return [
      {
        id: c.id,
        type: c.type,
        period: c.period.toISOString().slice(0, 10),
        dueDate: c.dueDate.toISOString().slice(0, 10),
        amount: Number(c.amount),
        open: round2(r.open),
        overdue: r.status === "OVERDUE",
        property: c.lease?.unit.building.property.name ?? null,
        chargeId: c.id,
        paid: round2(r.paid),
        status: r.status,
        dunLevel: r.dunLevel,
        leaseId: c.leaseId,
        unitId: c.lease?.unitId ?? null,
        unit: c.lease?.unit.label ?? null,
        propertyId: c.lease?.unit.building.propertyId ?? null,
      },
    ];
  });
  return { items, total: ledger.visible };
}

export async function createTicket(
  tenantId: string,
  data: { title: string; description?: string; propertyId?: string; priority?: string },
) {
  const propertyId =
    data.propertyId &&
    (await prisma.property.findFirst({ where: { id: data.propertyId, tenantId }, select: { id: true } }))
      ? data.propertyId
      : null;
  const created = await prisma.ticket.create({
    data: {
      tenantId,
      title: data.title,
      description: data.description ?? null,
      propertyId,
      priority: (data.priority as "NIEDRIG" | "MITTEL" | "HOCH") ?? "MITTEL",
    },
  });
  return { id: created.id, title: created.title, status: created.status };
}

export async function createPerson(
  tenantId: string,
  data: { firstName: string; lastName: string; email?: string; phone?: string; type?: string },
) {
  const created = await prisma.person.create({
    data: {
      tenantId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      type: (data.type as "MIETER" | "EIGENTUEMER" | "INTERESSENT" | "HANDWERKER" | "MAKLER" | "BANK" | "SONSTIGE") ?? "SONSTIGE",
    },
  });
  return { id: created.id, firstName: created.firstName, lastName: created.lastName };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const propSel = { property: { select: { name: true } } };

export async function listOwners(tenantId: string, o: ListOpts & { unitId?: string; personId?: string } = {}) {
  const where: Prisma.OwnerWhereInput = {
    tenantId,
    ...(o.unitId ? { unitId: o.unitId } : {}),
    ...(o.personId ? { personId: o.personId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.owner.findMany({
      where,
      include: {
        person: { select: { firstName: true, lastName: true } },
        unit: { select: { label: true, building: { select: { propertyId: true, property: { select: { name: true } } } } } },
      },
      orderBy: { id: "asc" },
      ...pg(o),
    }),
    prisma.owner.count({ where }),
  ]);
  const items = rows.map((w) => ({
    id: w.id,
    person: fullName(w.person),
    unit: w.unit.label,
    property: w.unit.building.property.name,
    share: w.share,
    personId: w.personId,
    unitId: w.unitId,
    propertyId: w.unit.building.propertyId,
  }));
  return { items, total };
}

export async function listMeters(tenantId: string, o: ListOpts & { unitId?: string } = {}) {
  const where: Prisma.MeterWhereInput = { tenantId, ...(o.unitId ? { unitId: o.unitId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.meter.findMany({
      where,
      include: {
        unit: { select: { label: true, building: { select: { propertyId: true, property: { select: { name: true } } } } } },
        readings: { orderBy: { date: "desc" }, take: 1 },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.meter.count({ where }),
  ]);
  const items = rows.map((m) => ({
    id: m.id,
    type: m.type,
    serialNo: m.serialNo,
    unit: m.unit.label,
    property: m.unit.building.property.name,
    lastReading: m.readings[0] ? { date: day(m.readings[0].date), value: num(m.readings[0].value) } : null,
    unitId: m.unitId,
    propertyId: m.unit.building.propertyId,
  }));
  return { items, total };
}

export async function listAccounts(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.account.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...pg(o) }),
    prisma.account.count({ where }),
  ]);
  // nexrees: balance summed in Postgres instead of loading every payment of the account
  const sums = rows.length
    ? await prisma.payment.groupBy({
        by: ["accountId", "direction"],
        where: { tenantId, accountId: { in: rows.map((a) => a.id) } },
        _sum: { amount: true },
      })
    : [];
  const items = rows.map((a) => {
    const balance = sums
      .filter((s) => s.accountId === a.id)
      .reduce((s, x) => s + (x.direction === "EINGANG" ? 1 : -1) * Number(x._sum.amount ?? 0), 0);
    // balance = booked (sum of payments); bankBalance = what the bank last reported
    return {
      id: a.id, name: a.name, type: a.type, iban: a.iban, balance: round2(balance),
      bankBalance: num(a.balance), bankBalanceAt: a.balanceAt,
    };
  });
  return { items, total };
}

export const CHARGE_FILTER_STATUSES = ["OPEN", "PARTIAL", "PAID", "OVERDUE", "UNPAID"] as const;
export type ChargeFilterStatus = (typeof CHARGE_FILTER_STATUSES)[number];

export async function listCharges(tenantId: string, o: ListOpts & { leaseId?: string; status?: ChargeFilterStatus } = {}) {
  const { skip, take } = pg(o);
  const map = (c: ChargeDetail, paid: number, status: ChargeStatus) => ({
    id: c.id,
    type: c.type,
    period: day(c.period),
    dueDate: day(c.dueDate),
    amount: num(c.amount),
    paid: round2(paid),
    unit: c.lease?.unit.label ?? null,
    open: round2(Number(c.amount) - paid),
    status,
    description: c.description,
    leaseId: c.leaseId,
    unitId: c.lease?.unitId ?? null,
    propertyId: c.lease?.unit.building.propertyId ?? null,
  });

  if (o.status) {
    // status needs the payments of every charge → computed in Postgres (charge-ledger)
    const ledger = await chargeLedgerPage(tenantId, { status: o.status, leaseId: o.leaseId }, skip, take);
    const details = await chargeDetails(tenantId, ledger.rows.map((r) => r.id));
    const items = ledger.rows.flatMap((r) => {
      const c = details.get(r.id);
      return c ? [map(c, r.paid, r.status)] : [];
    });
    return { items, total: ledger.visible };
  }

  const where: Prisma.ChargeWhereInput = { tenantId, ...(o.leaseId ? { leaseId: o.leaseId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.charge.findMany({ where, select: { id: true }, orderBy: [{ dueDate: "desc" }, { id: "asc" }], skip, take }),
    prisma.charge.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const [details, sums] = await Promise.all([
    chargeDetails(tenantId, ids),
    ids.length
      ? prisma.payment.groupBy({ by: ["chargeId"], where: { tenantId, chargeId: { in: ids } }, _sum: { amount: true } })
      : Promise.resolve([]),
  ]);
  const paidBy = new Map(sums.map((s) => [s.chargeId, Number(s._sum.amount ?? 0)]));
  const now = new Date();
  const items = ids.flatMap((id) => {
    const c = details.get(id);
    if (!c) return [];
    const paid = paidBy.get(id) ?? 0;
    return [map(c, paid, chargeStatus(Number(c.amount), paid, c.dueDate, now))];
  });
  return { items, total };
}

export async function listPayments(tenantId: string, o: ListOpts & { accountId?: string; chargeId?: string } = {}) {
  const where: Prisma.PaymentWhereInput = {
    tenantId,
    ...(o.accountId ? { accountId: o.accountId } : {}),
    ...(o.chargeId ? { chargeId: o.chargeId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { account: { select: { name: true } }, charge: { select: { leaseId: true } } },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.payment.count({ where }),
  ]);
  const items = rows.map((p) => ({
    id: p.id,
    date: day(p.date),
    amount: num(p.amount),
    direction: p.direction,
    reference: p.reference,
    account: p.account?.name ?? null,
    accountId: p.accountId,
    chargeId: p.chargeId,
    leaseId: p.charge?.leaseId ?? null,
    counterparty: p.counterparty,
  }));
  return { items, total };
}

export async function listDocuments(
  tenantId: string,
  o: ListOpts & { propertyId?: string; unitId?: string; personId?: string } = {},
) {
  const where: Prisma.DocumentWhereInput = {
    tenantId,
    ...(o.propertyId ? { propertyId: o.propertyId } : {}),
    ...(o.unitId ? { unitId: o.unitId } : {}),
    ...(o.personId ? { personId: o.personId } : {}),
    ...tokenizedWhere<Prisma.DocumentWhereInput>(o.q, SEARCH_FIELDS.document),
  };
  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { ...propSel, unit: { select: { label: true } }, person: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.document.count({ where }),
  ]);
  const items = rows.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    mime: d.mime,
    size: d.size,
    eInvoice: d.eInvoice,
    invoiceNo: d.invoiceNo,
    invoiceTotal: num(d.invoiceTotal),
    property: d.property?.name ?? null,
    createdAt: day(d.createdAt),
    propertyId: d.propertyId,
    unitId: d.unitId,
    unit: d.unit?.label ?? null,
    personId: d.personId,
    person: d.person ? fullName(d.person) : null,
  }));
  return { items, total };
}

export async function listMeetings(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      include: { ...propSel, _count: { select: { agendaItems: true, resolutions: true } } },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.meeting.count({ where }),
  ]);
  const items = rows.map((m) => ({
    id: m.id,
    title: m.title,
    date: day(m.date),
    status: m.status,
    location: m.location,
    property: m.property.name,
    agendaItems: m._count.agendaItems,
    resolutions: m._count.resolutions,
    propertyId: m.propertyId,
  }));
  return { items, total };
}

export async function listResolutions(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.resolution.findMany({
      where,
      include: { ...propSel, subcommunity: { select: { name: true } } },
      orderBy: [{ propertyId: "asc" }, { number: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.resolution.count({ where }),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    text: r.text,
    date: day(r.date),
    result: r.result,
    votes: { yes: r.votesYes, no: r.votesNo, abstain: r.votesAbstain },
    property: r.property.name,
    subcommunity: r.subcommunity?.name ?? null,
    propertyId: r.propertyId,
    meetingId: r.meetingId,
    subcommunityId: r.subcommunityId,
  }));
  return { items, total };
}

export async function listEconomicPlans(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.economicPlan.findMany({ where, include: propSel, orderBy: [{ year: "desc" }, { id: "asc" }], ...pg(o) }),
    prisma.economicPlan.count({ where }),
  ]);
  const items = rows.map((e) => ({
    id: e.id,
    property: e.property.name,
    year: e.year,
    totalAmount: num(e.totalAmount),
    monthly: round2(Number(e.totalAmount) / 12),
    note: e.note,
    propertyId: e.propertyId,
  }));
  return { items, total };
}

export async function listReserves(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.reserve.findMany({
      where,
      include: { ...propSel, subcommunity: { select: { name: true } }, transactions: { select: { amount: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.reserve.count({ where }),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    property: r.property.name,
    subcommunity: r.subcommunity?.name ?? null,
    balance: round2(r.transactions.reduce((s, t) => s + Number(t.amount), 0)),
    propertyId: r.propertyId,
    subcommunityId: r.subcommunityId,
  }));
  return { items, total };
}

export async function listAppointments(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: { ...propSel, persons: { select: { id: true } } },
      orderBy: [{ start: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.appointment.count({ where }),
  ]);
  const items = rows.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    start: a.start.toISOString(),
    end: a.end ? a.end.toISOString() : null,
    location: a.location,
    property: a.property?.name ?? null,
    propertyId: a.propertyId,
    personIds: a.persons.map((p) => p.id),
  }));
  return { items, total };
}

export async function listTasks(tenantId: string, o: ListOpts & { done?: boolean | null } = {}) {
  const where: Prisma.TaskWhereInput = { tenantId, ...(o.done == null ? {} : { done: o.done }) };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { assignee: { select: { name: true } } },
      orderBy: [{ done: "asc" }, { dueDate: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.task.count({ where }),
  ]);
  const items = rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: day(t.dueDate),
    done: t.done,
    assigneeId: t.assigneeId,
    assignee: t.assignee?.name ?? null,
    entity: t.entity,
    entityId: t.entityId,
    propertyId: t.propertyId,
  }));
  return { items, total };
}

export async function listContractors(tenantId: string, o: ListOpts = {}) {
  const where: Prisma.ContractorWhereInput = { tenantId, ...tokenizedWhere<Prisma.ContractorWhereInput>(o.q, SEARCH_FIELDS.contractor) };
  const [rows, total] = await Promise.all([
    prisma.contractor.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...pg(o) }),
    prisma.contractor.count({ where }),
  ]);
  return { items: rows.map((c) => ({ id: c.id, name: c.name, trade: c.trade, email: c.email, phone: c.phone })), total };
}

export async function listMaintenanceContracts(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.maintenanceContract.findMany({
      where,
      include: { ...propSel, contractor: { select: { name: true } } },
      orderBy: [{ nextDue: "asc" }, { id: "asc" }],
      ...pg(o),
    }),
    prisma.maintenanceContract.count({ where }),
  ]);
  const items = rows.map((m) => ({
    id: m.id,
    title: m.title,
    intervalMonths: m.intervalMonths,
    nextDue: day(m.nextDue),
    property: m.property.name,
    contractor: m.contractor?.name ?? null,
    propertyId: m.propertyId,
    contractorId: m.contractorId,
  }));
  return { items, total };
}

export async function listInsurances(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.insurance.findMany({ where, include: propSel, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...pg(o) }),
    prisma.insurance.count({ where }),
  ]);
  const items = rows.map((i) => ({
    id: i.id,
    type: i.type,
    insurer: i.insurer,
    policyNo: i.policyNo,
    premium: num(i.premium),
    startDate: day(i.startDate),
    endDate: day(i.endDate),
    property: i.property.name,
    propertyId: i.propertyId,
  }));
  return { items, total };
}

export async function listPropertyTaxes(tenantId: string, o: ListOpts = {}) {
  const where = { tenantId };
  const [rows, total] = await Promise.all([
    prisma.propertyTax.findMany({ where, include: propSel, orderBy: { id: "asc" }, ...pg(o) }),
    prisma.propertyTax.count({ where }),
  ]);
  const items = rows.map((p) => {
    const mess = p.messbetrag == null ? null : Number(p.messbetrag);
    const hebe = p.hebesatz == null ? null : Number(p.hebesatz);
    return {
      id: p.id,
      property: p.property.name,
      aktenzeichen: p.aktenzeichen,
      grundsteuerwert: num(p.grundsteuerwert),
      messbetrag: mess,
      hebesatz: hebe,
      jahresbetrag: mess != null && hebe != null ? round2(mess * (hebe / 100)) : null,
      propertyId: p.propertyId,
    };
  });
  return { items, total };
}

export async function createTask(tenantId: string, data: { title: string; dueDate?: string }) {
  const created = await prisma.task.create({
    data: { tenantId, title: data.title, dueDate: data.dueDate ? new Date(data.dueDate) : null },
  });
  return { id: created.id, title: created.title };
}

/** Portfolio-Kennzahlen (für KI/MCP-Überblick). */
export async function portfolioSummary(tenantId: string) {
  const now = new Date();
  const [propertyCount, units, leases, ledger, openTickets] = await Promise.all([
    prisma.property.count({ where: { tenantId } }),
    prisma.unit.findMany({ where: { tenantId }, select: { leases: { select: { startDate: true, endDate: true } } } }),
    prisma.lease.findMany({
      where: { tenantId, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
      include: { components: { select: { amount: true } } },
    }),
    // nexrees: open total from Postgres instead of loading every charge with its payments
    chargeLedgerPage(tenantId, {}, 0, 0, now),
    prisma.ticket.count({ where: { tenantId, status: { not: "ERLEDIGT" } } }),
  ]);
  const occupied = units.filter((u) =>
    u.leases.some((l) => l.startDate <= now && (!l.endDate || l.endDate >= now)),
  ).length;
  const monthlyRent = leases.reduce(
    (a, l) => a + Number(l.rentCold) + l.components.reduce((s, c) => s + Number(c.amount), 0),
    0,
  );
  return {
    properties: propertyCount,
    units: units.length,
    occupied,
    vacant: units.length - occupied,
    monthlyRent: round2(monthlyRent),
    openItemsTotal: round2(ledger.totalOpen),
    openTickets,
  };
}
