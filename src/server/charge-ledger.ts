// nexrees: charge status (paid / open / overdue) computed in Postgres instead of loading every
// charge with all its payments into the server. At 2,000 units x 3 years (~57k charges, ~60k
// payments) the old in-memory approach took 7-11 s per page view on finances and dunning.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ChargeStatus = "OPEN" | "PARTIAL" | "PAID" | "OVERDUE";
export const CHARGE_STATUSES: ChargeStatus[] = ["OPEN", "PARTIAL", "PAID", "OVERDUE"];
const EPS = 0.001; // same tolerance as the previous JS code

export type LedgerRow = { id: string; paid: number; open: number; status: ChargeStatus; dunLevel: number };

/** Same rule the finances page used in JS, kept here so tests can pin it. */
export function chargeStatus(amount: number, paid: number, dueDate: Date, now: Date): ChargeStatus {
  const open = amount - paid;
  if (open <= EPS) return "PAID";
  if (dueDate < now) return "OVERDUE";
  return paid > 0 ? "PARTIAL" : "OPEN";
}

// One row per charge of the tenant with paid sum, open amount, status and highest dunning level.
// `leaseIds` (non-empty) narrows charges, payments and dunning notices to those leases (portal).
function ledgerSql(tenantId: string, now: Date, leaseIds?: string[]) {
  const leaseCharges = leaseIds
    ? Prisma.sql` AND "chargeId" IN (SELECT id FROM "Charge" WHERE "tenantId" = ${tenantId} AND "leaseId" IN (${Prisma.join(leaseIds)}))`
    : Prisma.empty;
  const leaseScope = leaseIds ? Prisma.sql` AND ch."leaseId" IN (${Prisma.join(leaseIds)})` : Prisma.empty;
  return Prisma.sql`
    WITH c AS (
      SELECT ch.id, ch.amount::float8 AS amount, ch."dueDate", ch.period, ch.type::text AS type, ch."leaseId",
             COALESCE(p.paid, 0)::float8 AS paid, COALESCE(d.lvl, 0)::int AS "dunLevel"
      FROM "Charge" ch
      LEFT JOIN (
        SELECT "chargeId", SUM(amount) AS paid FROM "Payment"
        WHERE "tenantId" = ${tenantId} AND "chargeId" IS NOT NULL${leaseCharges} GROUP BY "chargeId"
      ) p ON p."chargeId" = ch.id
      LEFT JOIN (
        SELECT "chargeId", MAX(level) AS lvl FROM "DunningNotice"
        WHERE "tenantId" = ${tenantId}${leaseCharges} GROUP BY "chargeId"
      ) d ON d."chargeId" = ch.id
      WHERE ch."tenantId" = ${tenantId}${leaseScope}
    )
    SELECT c.*, (c.amount - c.paid) AS open,
      CASE WHEN c.amount - c.paid <= ${EPS} THEN 'PAID'
           WHEN c."dueDate" < ${now} THEN 'OVERDUE'
           WHEN c.paid > 0 THEN 'PARTIAL'
           ELSE 'OPEN' END AS status
    FROM c`;
}

export type LedgerFilter = { status?: string; type?: string; leaseId?: string; year?: number };

/** One page of charges (newest due date first) plus totals over all charges of the tenant. */
export async function chargeLedgerPage(tenantId: string, f: LedgerFilter, skip: number, take: number, now = new Date()) {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.status && (CHARGE_STATUSES as string[]).includes(f.status)) conds.push(Prisma.sql`l.status = ${f.status}`);
  else if (f.status === "UNPAID") conds.push(Prisma.sql`l.status <> 'PAID'`); // API: every charge with money open
  if (f.type) conds.push(Prisma.sql`l.type = ${f.type}`);
  if (f.leaseId) conds.push(Prisma.sql`l."leaseId" = ${f.leaseId}`);
  if (f.year) conds.push(Prisma.sql`EXTRACT(YEAR FROM l.period AT TIME ZONE 'UTC') = ${f.year}`);
  const where = Prisma.join(conds, " AND ");

  type Raw = { id: string; paid: number; open: number; status: ChargeStatus; dunLevel: number };
  const [rows, agg, years] = await Promise.all([
    prisma.$queryRaw<Raw[]>`SELECT l.id, l.paid, l.open, l.status, l."dunLevel" FROM (${ledgerSql(tenantId, now)}) l
      WHERE ${where} ORDER BY l."dueDate" DESC, l.id ASC OFFSET ${skip} LIMIT ${take}`,
    prisma.$queryRaw<{ visible: bigint; total_open: number | null }[]>`
      SELECT COUNT(*) FILTER (WHERE ${where}) AS visible, SUM(GREATEST(l.open, 0)) AS total_open
      FROM (${ledgerSql(tenantId, now)}) l`,
    prisma.$queryRaw<{ y: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM period AT TIME ZONE 'UTC')::int AS y FROM "Charge" WHERE "tenantId" = ${tenantId} ORDER BY y DESC`,
  ]);
  return {
    rows: rows.map((r) => ({ ...r, paid: Number(r.paid), open: Number(r.open), dunLevel: Number(r.dunLevel) })) as LedgerRow[],
    visible: Number(agg[0]?.visible ?? 0),
    totalOpen: Number(agg[0]?.total_open ?? 0),
    years: years.map((y) => Number(y.y)),
  };
}

/** Charges that still have money open (amount - payments > 0), oldest due date first. */
export async function openCharges(tenantId: string, now = new Date()): Promise<LedgerRow[]> {
  const rows = await prisma.$queryRaw<LedgerRow[]>`SELECT l.id, l.paid, l.open, l.status, l."dunLevel"
    FROM (${ledgerSql(tenantId, now)}) l WHERE l.status <> 'PAID' ORDER BY l."dueDate" ASC, l.id ASC`;
  return rows.map((r) => ({ ...r, paid: Number(r.paid), open: Number(r.open), dunLevel: Number(r.dunLevel) }));
}

export type LeaseOpenCharge = {
  id: string;
  leaseId: string;
  type: string;
  period: Date;
  dueDate: Date;
  amount: number;
  paid: number;
  open: number;
};

/** Open charges of some leases (a tenant's own, in the portal), oldest due date first. */
export async function openChargesForLeases(tenantId: string, leaseIds: string[], now = new Date()): Promise<LeaseOpenCharge[]> {
  if (leaseIds.length === 0) return [];
  const rows = await prisma.$queryRaw<LeaseOpenCharge[]>`SELECT l.id, l."leaseId", l.type, l.period, l."dueDate", l.amount, l.paid, l.open
    FROM (${ledgerSql(tenantId, now, leaseIds)}) l WHERE l.status <> 'PAID' ORDER BY l."dueDate" ASC, l.id ASC`;
  return rows.map((r) => ({ ...r, amount: Number(r.amount), paid: Number(r.paid), open: Number(r.open) }));
}
