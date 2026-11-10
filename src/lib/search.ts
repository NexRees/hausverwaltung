// nexrees: one search for the staff search page, GET /api/v1/search and the MCP `search` tool.
// The query is split on whitespace; every word must match (AND) in at least one of the fields
// (OR), case-insensitive. So "Erika Mustermann" finds firstName Erika + lastName Mustermann,
// and "Muster 12" finds unit 12 in property "Musterstraße".
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_TOKENS = 6;
const MAX_Q = 100;

/** Distinct words of a query (at most 6, query cut at 100 characters). */
export function searchTokens(q: string | null | undefined): string[] {
  const words = (q ?? "").trim().slice(0, MAX_Q).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out.slice(0, MAX_TOKENS);
}

/** `"a.b.c"` + leaf → `{ a: { b: { c: leaf } } }` (Prisma relation filters, e.g. "renters.some.person.lastName"). */
function nest(path: string, leaf: unknown): Record<string, unknown> {
  return path
    .split(".")
    .reduceRight<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

/**
 * Prisma `where` fragment: every token must match (AND) at least one field (OR), case-insensitive
 * "contains". Fields are dot paths. Empty query or no fields → `{}` (no filter).
 */
export function tokenizedWhere<W extends object = Record<string, unknown>>(
  q: string | null | undefined,
  fields: readonly string[],
): W {
  const tokens = searchTokens(q);
  if (!tokens.length || !fields.length) return {} as W;
  return {
    AND: tokens.map((tok) => ({
      OR: fields.map((f) => nest(f, { contains: tok, mode: "insensitive" })),
    })),
  } as W;
}

/** Fields searched per entity (also used by the `q` filter of the API lists). */
export const SEARCH_FIELDS = {
  property: ["name", "street", "zip", "city"],
  unit: ["label", "building.name", "building.property.name"],
  person: ["firstName", "lastName", "email", "phone"],
  lease: ["unit.label", "unit.building.property.name", "renters.some.person.firstName", "renters.some.person.lastName"],
  ticket: ["title", "description", "property.name", "unit.label"],
  meeting: ["title", "location", "property.name"],
  contractor: ["name", "trade", "email"],
  document: ["name", "invoiceNo", "property.name", "unit.label", "person.firstName", "person.lastName"],
} as const;

export const SEARCH_ENTITIES = ["property", "unit", "person", "lease", "ticket", "meeting", "contractor", "document"] as const;
export type SearchEntity = (typeof SEARCH_ENTITIES)[number];

export type SearchHit = {
  entity: SearchEntity;
  id: string;
  label: string;
  sublabel: string;
  /** Path in the staff app (no locale prefix); documents point to the file viewer. */
  href: string;
  /** Single-record read in the REST API. */
  apiHref: string;
  /** Raw status code where the record has one (ticket, meeting). */
  status?: string;
};

export type SearchGroup = { entity: SearchEntity; total: number; hits: SearchHit[] };

/** App path of a record (staff UI, without locale). */
export function appHref(entity: string, id: string, label?: string): string | null {
  switch (entity) {
    case "property":
      return `/properties/${id}`;
    case "unit":
      return `/units/${id}`;
    case "person":
      return `/persons/${id}`;
    case "lease":
      return `/leases/${id}`;
    case "meeting":
      return `/meetings/${id}`;
    case "ticket": // no detail page; the list filtered to the ticket
      return label ? `/tickets?q=${encodeURIComponent(label)}` : "/tickets";
    case "contractor":
      return "/tickets";
    case "document":
      return `/api/documents/${id}?inline=1`;
    default:
      return null;
  }
}

export const apiHref = (entity: string, id: string) => `/api/v1/records/${entity}/${id}`;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

function hit(entity: SearchEntity, id: string, label: string, sublabel: string, status?: string): SearchHit {
  return { entity, id, label, sublabel, href: appHref(entity, id, label) ?? "", apiHref: apiHref(entity, id), ...(status ? { status } : {}) };
}

type Runner = (tenantId: string, q: string, take: number) => Promise<SearchGroup>;

const RUNNERS: Record<SearchEntity, Runner> = {
  property: async (tenantId, q, take) => {
    const where: Prisma.PropertyWhereInput = { tenantId, ...tokenizedWhere<Prisma.PropertyWhereInput>(q, SEARCH_FIELDS.property) };
    const [rows, total] = await Promise.all([
      prisma.property.findMany({ where, take, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, street: true, zip: true, city: true } }),
      prisma.property.count({ where }),
    ]);
    return { entity: "property", total, hits: rows.map((p) => hit("property", p.id, p.name, `${p.street}, ${p.zip} ${p.city}`)) };
  },
  unit: async (tenantId, q, take) => {
    const where: Prisma.UnitWhereInput = { tenantId, ...tokenizedWhere<Prisma.UnitWhereInput>(q, SEARCH_FIELDS.unit) };
    const [rows, total] = await Promise.all([
      prisma.unit.findMany({
        where,
        take,
        orderBy: [{ label: "asc" }, { id: "asc" }],
        select: { id: true, label: true, building: { select: { name: true, property: { select: { name: true } } } } },
      }),
      prisma.unit.count({ where }),
    ]);
    return { entity: "unit", total, hits: rows.map((u) => hit("unit", u.id, u.label, join(u.building.property.name, u.building.name))) };
  },
  person: async (tenantId, q, take) => {
    const where: Prisma.PersonWhereInput = { tenantId, ...tokenizedWhere<Prisma.PersonWhereInput>(q, SEARCH_FIELDS.person) };
    const [rows, total] = await Promise.all([
      prisma.person.findMany({
        where,
        take,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      }),
      prisma.person.count({ where }),
    ]);
    return { entity: "person", total, hits: rows.map((p) => hit("person", p.id, name(p), p.email ?? p.phone ?? "")) };
  },
  lease: async (tenantId, q, take) => {
    const where: Prisma.LeaseWhereInput = { tenantId, ...tokenizedWhere<Prisma.LeaseWhereInput>(q, SEARCH_FIELDS.lease) };
    const [rows, total] = await Promise.all([
      prisma.lease.findMany({
        where,
        take,
        orderBy: [{ startDate: "desc" }, { id: "asc" }],
        select: {
          id: true,
          startDate: true,
          endDate: true,
          unit: { select: { label: true, building: { select: { property: { select: { name: true } } } } } },
          renters: { select: { person: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.lease.count({ where }),
    ]);
    return {
      entity: "lease",
      total,
      hits: rows.map((l) => {
        const renters = l.renters.map((r) => name(r.person)).join(", ");
        const label = `${l.unit.building.property.name} · ${l.unit.label}${renters ? ` — ${renters}` : ""}`;
        return hit("lease", l.id, label, `${day(l.startDate)} – ${day(l.endDate) ?? "…"}`);
      }),
    };
  },
  ticket: async (tenantId, q, take) => {
    const where: Prisma.TicketWhereInput = { tenantId, ...tokenizedWhere<Prisma.TicketWhereInput>(q, SEARCH_FIELDS.ticket) };
    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, title: true, status: true, property: { select: { name: true } }, unit: { select: { label: true } } },
      }),
      prisma.ticket.count({ where }),
    ]);
    return {
      entity: "ticket",
      total,
      hits: rows.map((t) => hit("ticket", t.id, t.title, join(t.property?.name, t.unit?.label), t.status)),
    };
  },
  meeting: async (tenantId, q, take) => {
    const where: Prisma.MeetingWhereInput = { tenantId, ...tokenizedWhere<Prisma.MeetingWhereInput>(q, SEARCH_FIELDS.meeting) };
    const [rows, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        take,
        orderBy: [{ date: "desc" }, { id: "asc" }],
        select: { id: true, title: true, date: true, status: true, property: { select: { name: true } } },
      }),
      prisma.meeting.count({ where }),
    ]);
    return {
      entity: "meeting",
      total,
      hits: rows.map((m) => hit("meeting", m.id, m.title, join(day(m.date), m.property.name), m.status)),
    };
  },
  contractor: async (tenantId, q, take) => {
    const where: Prisma.ContractorWhereInput = { tenantId, ...tokenizedWhere<Prisma.ContractorWhereInput>(q, SEARCH_FIELDS.contractor) };
    const [rows, total] = await Promise.all([
      prisma.contractor.findMany({ where, take, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, trade: true } }),
      prisma.contractor.count({ where }),
    ]);
    return { entity: "contractor", total, hits: rows.map((c) => hit("contractor", c.id, c.name, c.trade)) };
  },
  document: async (tenantId, q, take) => {
    const where: Prisma.DocumentWhereInput = { tenantId, ...tokenizedWhere<Prisma.DocumentWhereInput>(q, SEARCH_FIELDS.document) };
    const [rows, total] = await Promise.all([
      prisma.document.findMany({
        where,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          property: { select: { name: true } },
          unit: { select: { label: true } },
          person: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);
    return {
      entity: "document",
      total,
      hits: rows.map((d) => hit("document", d.id, d.name, join(d.property?.name, d.unit?.label, d.person ? name(d.person) : null))),
    };
  },
};

export type SearchResult = { q: string; total: number; groups: SearchGroup[]; hits: SearchHit[] };

/**
 * Search across record types of one company. `limit` is per entity (default 10, max 50);
 * `total` per group is the real count, so callers can say "20 of 134".
 */
export async function searchEntities(
  tenantId: string,
  q: string,
  opts: { limit?: number; entities?: readonly SearchEntity[] } = {},
): Promise<SearchResult> {
  const query = (q ?? "").trim().slice(0, MAX_Q);
  if (!searchTokens(query).length) return { q: query, total: 0, groups: [], hits: [] };
  const take = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 10)));
  const entities = opts.entities?.length ? opts.entities : SEARCH_ENTITIES;
  const groups = await Promise.all(entities.map((e) => RUNNERS[e](tenantId, query, take)));
  return {
    q: query,
    total: groups.reduce((a, g) => a + g.total, 0),
    groups,
    hits: groups.flatMap((g) => g.hits),
  };
}
