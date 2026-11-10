// Copyright (c) 2026 NexRees.
//
// Glue between the ledger core (./core.ts) and the host application (HaVeWa fork): the database
// port on Prisma, the acting user for the journal, and checks against host tables.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asActor, type Actor } from "@/server/ledger";
import type { LedgerDb } from "./core";

type Client = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

/** The core's database port on a Prisma client or transaction. */
export function ledgerDb(client: Client = prisma): LedgerDb {
  return { query: (sql, ...params) => client.$queryRawUnsafe(sql, ...params) };
}

/** Runs ledger writes in one transaction that names the acting user for the journal. */
export function withLedger<T>(actor: Actor, fn: (db: LedgerDb) => Promise<T>): Promise<T> {
  return asActor(actor, (tx) => fn(ledgerDb(tx)));
}

/** A property id sent by a client must belong to the company. */
export async function propertyOfTenant(tenantId: string, propertyId: string | null | undefined): Promise<string | null> {
  if (!propertyId) return null;
  const p = await prisma.property.findFirst({ where: { id: propertyId, tenantId }, select: { id: true } });
  return p?.id ?? null;
}

/** Names of the properties on a page of journal entries. */
export async function propertyNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await prisma.property.findMany({ where: { tenantId, id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}
