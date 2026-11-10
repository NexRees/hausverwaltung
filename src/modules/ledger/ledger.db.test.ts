// Copyright (c) 2026 NexRees.
// Database tests for the general ledger (posting triggers, Storno, hash chain, period close).
// They need a migrated Postgres and run only on request:
//   NEXREES_DB_TEST=1 DATABASE_URL=postgresql://…/scratch npx vitest run src/modules/ledger/ledger.db.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { listAccounts, listJournal, postManualEntry, reverseManualEntry, trialBalance, verifyChain, datevBookings, type LedgerDb } from "./core";

const DB = process.env.NEXREES_DB_TEST === "1";
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe.skipIf(!DB)("general ledger against a real database", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { ledgerDb, withLedger } = await import("./havewa");
  const db: LedgerDb = ledgerDb();
  const actor = { id: "u1", name: "Lena Hartmann", source: "test" };
  let tenantId = "";
  let otherTenantId = "";
  let propertyId = "";
  let leaseId = "";
  let bankId = "";

  const balance = async (key: string, f: { propertyId?: string } = {}) => (await trialBalance(db, tenantId, f)).find((a) => a.key === key)?.closing ?? 0;
  const entriesOf = (sourceId: string) => prisma.journalEntry.findMany({ where: { tenantId, sourceId }, orderBy: { seq: "asc" }, include: { lines: { orderBy: { position: "asc" } } } });

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: `ledgertest-${Date.now()}` } });
    tenantId = t.id;
    otherTenantId = (await prisma.tenant.create({ data: { name: `ledgertest-other-${Date.now()}` } })).id;
    const p = await prisma.property.create({ data: { tenantId, name: "Lindenallee 4", street: "Lindenallee 4", zip: "60311", city: "Frankfurt" } });
    propertyId = p.id;
    const b = await prisma.building.create({ data: { tenantId, name: "A", propertyId } });
    const unit = await prisma.unit.create({ data: { tenantId, label: "1.OG links", area: 70, buildingId: b.id } });
    leaseId = (await prisma.lease.create({ data: { tenantId, unitId: unit.id, startDate: utc("2026-01-01"), rentCold: 800 } })).id;
    bankId = (await prisma.account.create({ data: { tenantId, name: "Mietkonto Sparkasse", type: "BANK" } })).id;
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId].filter(Boolean)) {
      await prisma.$transaction(async (t) => {
        await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
        await t.auditLog.deleteMany({ where: { tenantId: id } });
        await t.tenant.delete({ where: { id } });
      });
    }
    await prisma.$disconnect();
  });

  it("creates the default chart and one account per bank account", async () => {
    const accounts = await listAccounts(db, tenantId);
    expect(accounts.find((a) => a.key === "DEBTORS")).toMatchObject({ number: "1400", type: "ASSET" });
    expect(accounts.find((a) => a.key === `ACC:${bankId}`)).toMatchObject({ number: "1201", name: "Mietkonto Sparkasse", type: "ASSET" });
    expect(new Set(accounts.map((a) => a.number)).size).toBe(accounts.length);
  });

  it("posts a charge as debtor an income, with property and lease", async () => {
    const c = await prisma.charge.create({ data: { tenantId, leaseId, type: "MIETE", period: utc("2026-11-01"), dueDate: utc("2026-11-03"), amount: 800 } });
    const [e] = await entriesOf(c.id);
    expect(e).toMatchObject({ kind: "BOOKING", sourceTable: "Charge", propertyId, text: "Sollstellung Miete 11/2026" });
    expect(e.date.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(e.lines.map((l) => [Number(l.debit), Number(l.credit), l.leaseId])).toEqual([[800, 0, leaseId], [0, 800, null]]);
    expect(await balance("DEBTORS")).toBe(800);
    expect(await balance("INCOME_RENT")).toBe(-800);
  });

  it("posts a matched payment as bank an debtor and an unmatched one to unclear receipts", async () => {
    const c = await prisma.charge.findFirstOrThrow({ where: { tenantId } });
    await prisma.payment.create({ data: { tenantId, accountId: bankId, chargeId: c.id, date: utc("2026-11-04"), amount: 500, reference: "Miete Nov Teil 1" } });
    const loose = await prisma.payment.create({ data: { tenantId, accountId: bankId, date: utc("2026-11-05"), amount: 300 } });
    expect(await balance("DEBTORS")).toBe(300);
    expect(await balance(`ACC:${bankId}`)).toBe(800);
    expect(await balance("SUSPENSE_IN")).toBe(-300);

    // matching it later: Storno of the unclear posting, new posting against the debtor
    await prisma.payment.update({ where: { id: loose.id }, data: { chargeId: c.id } });
    const es = await entriesOf(loose.id);
    expect(es.map((e) => e.kind)).toEqual(["BOOKING", "STORNO", "BOOKING"]);
    expect(es[1].reversesId).toBe(es[0].id);
    expect(await balance("DEBTORS")).toBe(0);
    expect(await balance("SUSPENSE_IN")).toBe(0);
    expect(await balance(`ACC:${bankId}`)).toBe(800);
  });

  it("does not post when only a note changes, and reverses on delete", async () => {
    const p = await prisma.payment.create({ data: { tenantId, date: utc("2026-11-06"), amount: 42, direction: "AUSGANG" } });
    await prisma.payment.update({ where: { id: p.id }, data: { note: "Hausmeister" } });
    expect(await entriesOf(p.id)).toHaveLength(1);
    expect(await balance("SUSPENSE_OUT")).toBe(42);
    expect(await balance("BANK")).toBe(-42);
    await prisma.payment.delete({ where: { id: p.id } });
    expect((await entriesOf(p.id)).map((e) => e.kind)).toEqual(["BOOKING", "STORNO"]);
    expect(await balance("SUSPENSE_OUT")).toBe(0);
    expect(await balance("BANK")).toBe(0);
  });

  it("posts a credit note the other way round and a deposit as liability", async () => {
    const credit = await prisma.charge.create({ data: { tenantId, leaseId, type: "NEBENKOSTEN", period: utc("2026-11-01"), dueDate: utc("2026-11-03"), amount: -120 } });
    const [e] = await entriesOf(credit.id);
    expect(e.lines.map((l) => [Number(l.debit), Number(l.credit)])).toEqual([[0, 120], [120, 0]]);
    await prisma.charge.create({ data: { tenantId, leaseId, type: "KAUTION", period: utc("2026-11-01"), dueDate: utc("2026-11-03"), amount: 2400 } });
    expect(await balance("DEPOSITS")).toBe(-2400);
    expect(await balance("DEBTORS")).toBe(2280);
  });

  it("keeps every entry balanced and the books per property", async () => {
    const rows = await trialBalance(db, tenantId);
    const round = (n: number) => Math.round(n * 100) / 100;
    expect(round(rows.reduce((s, a) => s + a.closing, 0))).toBe(0);
    expect(round(rows.reduce((s, a) => s + a.debit, 0))).toBe(round(rows.reduce((s, a) => s + a.credit, 0)));
    expect(await balance("DEBTORS", { propertyId })).toBe(2280);
    expect(await balance("DEBTORS", { propertyId: "nope" })).toBe(0);
  });

  it("posts and reverses a free entry as the acting user", async () => {
    const accounts = await listAccounts(db, tenantId);
    const expense = await prisma.ledgerAccount.create({ data: { tenantId, number: "4100", name: "Hausmeister", type: "EXPENSE" } });
    const bank = accounts.find((a) => a.key === `ACC:${bankId}`)!;
    const id = await withLedger(actor, (d) => postManualEntry(d, tenantId, { date: "2026-11-07", text: "Hausmeister November", debitAccountId: expense.id, creditAccountId: bank.id, amount: 250, propertyId }));
    const e = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    expect(e).toMatchObject({ userId: "u1", userName: "Lena Hartmann", source: "test", sourceTable: null, propertyId });
    const stornoId = await withLedger(actor, (d) => reverseManualEntry(d, tenantId, id));
    expect(await prisma.journalEntry.findUniqueOrThrow({ where: { id: stornoId } })).toMatchObject({ kind: "STORNO", reversesId: id, text: "Storno: Hausmeister November" });
    await expect(withLedger(actor, (d) => reverseManualEntry(d, tenantId, id))).rejects.toThrow(/bereits storniert/);
    await expect(withLedger(actor, (d) => reverseManualEntry(d, tenantId, stornoId))).rejects.toThrow(/Stornobuchung/);
    const charge = (await prisma.journalEntry.findFirstOrThrow({ where: { tenantId, sourceTable: "Charge" } })).id;
    await expect(withLedger(actor, (d) => reverseManualEntry(d, tenantId, charge))).rejects.toMatchObject({ code: "ledger_has_document" });
  });

  it("refuses accounts of another company and unbalanced or direct writes", async () => {
    const foreign = (await listAccounts(db, otherTenantId))[0];
    const own = (await listAccounts(db, tenantId))[0];
    await expect(postManualEntry(db, tenantId, { date: "2026-11-07", text: "x", debitAccountId: own.id, creditAccountId: foreign.id, amount: 1 })).rejects.toThrow(/gehört nicht zu diesem Mandanten/);
    const lines = JSON.stringify([{ id: own.id, debit: 10 }, { key: "BANK", credit: 9 }]);
    await expect(prisma.$queryRawUnsafe(`SELECT nexrees_ledger_post($1, '2026-11-07'::date, 'x', NULL, NULL, NULL, 'BOOKING', NULL, $2::jsonb)`, tenantId, lines)).rejects.toThrow(/NEXREES_LEDGER_UNBALANCED/);
    const e = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId } });
    await expect(prisma.journalEntry.update({ where: { id: e.id }, data: { text: "geändert" } })).rejects.toThrow(/NEXREES_LEDGER_IMMUTABLE/);
    await expect(prisma.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/NEXREES_LEDGER_IMMUTABLE/);
    await expect(prisma.journalLine.updateMany({ where: { entryId: e.id }, data: { debit: 1 } })).rejects.toThrow(/NEXREES_LEDGER_IMMUTABLE/);
    await expect(prisma.journalLine.create({ data: { id: "x", tenantId, entryId: e.id, position: 9, accountId: own.id, debit: 1 } })).rejects.toThrow(/NEXREES_LEDGER_IMMUTABLE/);
    const used = await prisma.ledgerAccount.findFirstOrThrow({ where: { tenantId, key: "DEBTORS" } });
    await expect(prisma.ledgerAccount.update({ where: { id: used.id }, data: { type: "INCOME" } })).rejects.toThrow(/NEXREES_LEDGER_ACCOUNT_USED/);
    await prisma.ledgerAccount.update({ where: { id: used.id }, data: { name: "Forderungen Mieter", datevNumber: "1410" } }); // renaming stays possible
  });

  it("numbers without gaps and detects a changed entry", async () => {
    const before = await verifyChain(db, tenantId);
    const n = await prisma.journalEntry.count({ where: { tenantId } });
    expect(before).toMatchObject({ entries: n, firstBadSeq: null, headSeq: n });
    expect(before.headHash).toMatch(/^[0-9a-f]{64}$/);

    // Someone with database access changes an amount behind the triggers' back.
    const victim = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId, seq: 2 }, include: { lines: true } });
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.$executeRaw`UPDATE "JournalLine" SET "debit" = "debit" + 1 WHERE "entryId" = ${victim.id} AND "debit" > 0`;
    });
    expect((await verifyChain(db, tenantId)).firstBadSeq).toBe(2);
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.$executeRaw`UPDATE "JournalLine" SET "debit" = "debit" - 1 WHERE "entryId" = ${victim.id} AND "debit" > 0`;
    });
    expect((await verifyChain(db, tenantId)).firstBadSeq).toBeNull();
  });

  it("posts concurrent bookings without a gap or a fork", async () => {
    const before = await prisma.journalEntry.count({ where: { tenantId } });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => prisma.payment.create({ data: { tenantId, accountId: bankId, date: utc("2026-11-08"), amount: 10 + i } })),
    );
    const v = await verifyChain(db, tenantId);
    expect(v).toMatchObject({ entries: before + 12, firstBadSeq: null, headSeq: before + 12 });
  });

  it("lists the journal with filters and exports DATEV rows from it", async () => {
    const all = await listJournal(db, tenantId, { limit: 5, offset: 0 });
    expect(all.items).toHaveLength(5);
    expect(all.items[0].seq).toBe(all.total);
    const bank = (await listAccounts(db, tenantId)).find((a) => a.key === `ACC:${bankId}`)!;
    const byAccount = await listJournal(db, tenantId, { accountId: bank.id, from: "2026-11-04", to: "2026-11-05", limit: 50, offset: 0 });
    expect(byAccount.items.every((e) => e.lines.some((l) => l.accountId === bank.id))).toBe(true);
    expect(byAccount.total).toBe(4); // two payments, one of them re-posted (Storno + new)
    expect((await listJournal(db, tenantId, { q: "Teil 1", limit: 50, offset: 0 })).total).toBe(1);
    expect((await listJournal(db, tenantId, { q: "100%", limit: 50, offset: 0 })).total).toBe(0);

    const { rows, skipped } = await datevBookings(db, tenantId, 2026);
    expect(skipped).toEqual([]);
    expect(rows.length).toBe(await prisma.journalEntry.count({ where: { tenantId } }));
    expect(rows[0]).toMatchObject({ debitCredit: "S", account: "1410", contraAccount: "8100", amount: 800, invoiceField: "1" }); // DATEV number of the debtor account
  });

  it("applies the period close to documents and free entries, and keeps reading open", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { bookingsLockedUntil: utc("2026-10-31") } });
    const [a, b] = await listAccounts(db, tenantId);
    await expect(postManualEntry(db, tenantId, { date: "2026-10-31", text: "zu spät", debitAccountId: a.id, creditAccountId: b.id, amount: 1 })).rejects.toMatchObject({ code: "period_locked", status: 409 });
    await postManualEntry(db, tenantId, { date: "2026-11-01", text: "offen", debitAccountId: a.id, creditAccountId: b.id, amount: 1 });
    expect((await verifyChain(db, tenantId)).firstBadSeq).toBeNull();
  });

  it("backfills documents loaded without triggers and rebuilds only in purge mode", async () => {
    const before = await prisma.journalEntry.count({ where: { tenantId } });
    const debtors = await balance("DEBTORS");
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.charge.create({ data: { tenantId, leaseId, type: "MIETE", period: utc("2026-09-01"), dueDate: utc("2026-09-03"), amount: 800 } }); // closed month, no trigger
    });
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(before);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT nexrees_ledger_backfill(${tenantId}) AS n`;
    expect(n).toBe(1);
    expect(await balance("DEBTORS")).toBe(debtors + 800);
    expect((await prisma.$queryRaw<{ n: number }[]>`SELECT nexrees_ledger_backfill(${tenantId}) AS n`)[0].n).toBe(0); // idempotent

    await expect(prisma.$queryRaw`SELECT nexrees_ledger_rebuild(${tenantId})`).rejects.toThrow(/NEXREES_LEDGER_IMMUTABLE/);
    const manual = await prisma.journalEntry.count({ where: { tenantId, sourceTable: null } });
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.$executeRaw`SELECT nexrees_ledger_rebuild(${tenantId})`;
    });
    // Stornos of documents are gone (each document posted once); free entries and balances stay
    expect(await prisma.journalEntry.count({ where: { tenantId, sourceTable: null } })).toBe(manual);
    expect(await prisma.journalEntry.count({ where: { tenantId, kind: "STORNO", sourceTable: { not: null } } })).toBe(0);
    expect(await balance("DEBTORS")).toBe(debtors + 800);
    expect((await verifyChain(db, tenantId)).firstBadSeq).toBeNull();
  });

  it("keeps the journals of two companies apart", async () => {
    expect((await listJournal(db, otherTenantId, { limit: 10, offset: 0 })).total).toBe(0);
    expect(await verifyChain(db, otherTenantId)).toMatchObject({ entries: 0, firstBadSeq: null, headSeq: 0 });
  });
});
