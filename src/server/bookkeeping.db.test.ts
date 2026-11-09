// nexrees: database tests for the bookkeeping guards (period close triggers, bank sync, camt.053
// import, SEPA collection). They need a migrated Postgres and run only on request:
//   NEXREES_DB_TEST=1 DATABASE_URL=postgresql://…/scratch npx vitest run src/server/bookkeeping.db.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const DB = process.env.NEXREES_DB_TEST === "1";

const session = { user: { id: "", tenantId: "", role: "ADMIN", name: "Lena Hartmann", email: "lena@example.test", superAdmin: false, locale: "de" } };
vi.mock("@/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/acting-tenant", () => ({ actingTenantId: async (u: { tenantId: string }) => u.tenantId }));
const bankTx: Record<string, unknown>[] = [];
const fetchedFrom: string[] = [];
vi.mock("@/lib/adapters/enablebanking", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/enablebanking")>()),
  getTransactions: async (_c: unknown, _uid: string, from: string) => {
    fetchedFrom.push(from);
    return bankTx;
  },
  getBalances: async () => [],
}));

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const tx = (date: string, amount: number, id: string) => ({
  transaction_id: id, booking_date: date, credit_debit_indicator: "CRDT",
  transaction_amount: { amount: String(amount), currency: "EUR" }, remittance_information: [`Miete ${id}`],
});

describe.skipIf(!DB)("bookkeeping guards against a real database", async () => {
  const { prisma } = await import("@/lib/prisma");
  let tenantId = "";
  let leaseId = "";
  let personId = "";

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: `dbtest-${Date.now()}` } });
    tenantId = t.id;
    const u = await prisma.user.create({ data: { tenantId, email: `lena-${t.id}@example.test`, name: "Lena Hartmann", passwordHash: "x" } });
    Object.assign(session.user, { id: u.id, tenantId });
    const p = await prisma.property.create({ data: { tenantId, name: "Haus", street: "Hauptstraße 1", zip: "60311", city: "Frankfurt" } });
    const b = await prisma.building.create({ data: { tenantId, name: "A", propertyId: p.id } });
    const unit = await prisma.unit.create({ data: { tenantId, label: "1.OG", area: 70, buildingId: b.id } });
    const lease = await prisma.lease.create({ data: { tenantId, unitId: unit.id, startDate: utc("2025-01-01"), rentCold: 800 } });
    leaseId = lease.id;
    const person = await prisma.person.create({ data: { tenantId, firstName: "Иван", lastName: "Петров" } });
    personId = person.id;
    await prisma.renter.createMany({ data: [{ tenantId, personId, leaseId }, { tenantId, personId, leaseId }] }); // entered twice
  });

  afterAll(async () => {
    if (tenantId) await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.auditLog.deleteMany({ where: { tenantId } });
      await t.tenant.delete({ where: { id: tenantId } });
    });
    await prisma.$disconnect();
  });

  it("closes whole months only, and only forward", async () => {
    await expect(prisma.tenant.update({ where: { id: tenantId }, data: { bookingsLockedUntil: utc("2026-10-15") } })).rejects.toThrow(/NEXREES_LOCK_MONTH_END/);
    await prisma.tenant.update({ where: { id: tenantId }, data: { bookingsLockedUntil: utc("2026-10-31") } });
    await expect(prisma.tenant.update({ where: { id: tenantId }, data: { bookingsLockedUntil: utc("2026-09-30") } })).rejects.toThrow(/NEXREES_LOCK_BACKWARDS/);
  });

  it("refuses bookings in the closed months but not cost inputs of a statement year", async () => {
    await expect(prisma.payment.create({ data: { tenantId, date: utc("2026-10-20"), amount: 10 } })).rejects.toThrow(/NEXREES_PERIOD_LOCKED/);
    await prisma.charge.create({ data: { tenantId, leaseId, period: utc("2026-11-01"), dueDate: utc("2026-11-03"), amount: 1 } }).then((c) => prisma.charge.delete({ where: { id: c.id } }));
    const p = await prisma.property.findFirstOrThrow({ where: { tenantId } });
    const cost = await prisma.costEntry.create({ data: { tenantId, propertyId: p.id, year: 2025, type: "WASSER", amount: 1200 } });
    await prisma.costEntry.update({ where: { id: cost.id }, data: { amount: 1250 } }); // 2025 statement still being prepared
  });

  it("bank sync skips closed-period transactions, imports the rest and moves on", async () => {
    const { syncLink } = await import("@/lib/bank-sync");
    const acc = await prisma.account.create({ data: { tenantId, name: "Konto" } });
    const conn = await prisma.bankConnector.create({ data: { tenantId, applicationId: "app", privateKeyEnc: "x" } });
    const link = await prisma.bankLink.create({
      data: { tenantId, connectorId: conn.id, accountId: acc.id, aspspName: "Bank", aspspCountry: "DE", sessionId: "s", accountUid: "u", lastSyncAt: utc("2026-11-02") },
    });
    bankTx.splice(0, bankTx.length, tx("2026-10-31", 800, "late"), tx("2026-11-05", 800, "nov"));
    const r1 = await syncLink(tenantId, link.id, { applicationId: "app", privateKeyPem: "" });
    expect(r1).toMatchObject({ imported: 1, skippedLocked: 1, lockedUntil: "2026-10-31" });
    expect(fetchedFrom.at(-1)).toBe("2026-11-01"); // window starts after the closed period
    const after = await prisma.bankLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(after.lastSyncAt!.getTime()).toBeGreaterThan(utc("2026-11-02").getTime());
    const r2 = await syncLink(tenantId, link.id, { applicationId: "app", privateKeyPem: "" });
    expect(r2).toMatchObject({ imported: 0, skippedLocked: 1 });
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.payment.deleteMany({ where: { tenantId } });
    });
  });

  it("camt.053 import is atomic, deduplicated and reports closed-period entries", async () => {
    const { importCamtEntries } = await import("@/lib/bank-import");
    const actor = { id: session.user.id, name: "Lena Hartmann", source: "ui" };
    const e = (date: string, amount: number) => ({ date, amount, direction: "EINGANG" as const, reference: "Miete" });
    const file = [e("2026-10-30", 500), e("2026-11-02", 600), e("2026-11-02", 600)];
    expect(await importCamtEntries(tenantId, null, file, actor)).toMatchObject({ imported: 2, duplicates: 0, skippedLocked: 1 });
    expect(await importCamtEntries(tenantId, null, file, actor)).toMatchObject({ imported: 0, duplicates: 2, skippedLocked: 1 });
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(2);
    await prisma.$transaction(async (t) => {
      await t.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      await t.payment.deleteMany({ where: { tenantId } });
    });
  });

  it("SEPA: nets credits, does not double a duplicate renter, never debits a charge twice", async () => {
    const { earliestCollectionDate } = await import("@/lib/adapters/sepa");
    const { POST } = await import("@/app/api/export/sepa/route");
    await prisma.tenant.update({ where: { id: tenantId }, data: { sepaCreditorId: "DE98ZZZ09999999999", sepaCreditorIban: "DE89370400440532013000" } });
    await prisma.sepaMandate.create({ data: { tenantId, personId, iban: "DE89370400440532013000", mandateRef: "M-2026-0001", signedDate: utc("2025-01-01") } });
    const day = earliestCollectionDate(new Date());
    const due = new Date(day.getTime() - 5 * 86_400_000);
    const period = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1));
    await prisma.charge.create({ data: { tenantId, leaseId, period, dueDate: due, amount: 800, type: "MIETE" } });
    await prisma.charge.create({ data: { tenantId, leaseId, period, dueDate: due, amount: -150, type: "SONSTIGES" } }); // credit
    const date = day.toISOString().slice(0, 10);
    const post = () => POST(new Request(`http://x/api/export/sepa?date=${date}`, { method: "POST" }));

    const r1 = await post();
    const xml = await r1.text();
    expect(r1.status, xml).toBe(200);
    expect(xml).toContain("<InstdAmt Ccy=\"EUR\">650.00</InstdAmt>"); // 800 - 150, not 800 and not 1600
    expect(xml).toContain("<Nm>Ivan Petrov</Nm>");
    expect(xml).toContain("<MndtId>M-2026-0001</MndtId>");

    const r2 = await post();
    expect(r2.status).toBe(404); // already in a file: no second debit

    const file = await prisma.sepaCollection.findFirstOrThrow({ where: { tenantId } });
    expect(file).toMatchObject({ count: 1, createdByName: "Lena Hartmann" });
    // what cancelSepaCollection does for a file that was never submitted
    await prisma.sepaCollection.update({ where: { id: file.id }, data: { cancelledAt: new Date() } });
    const r3 = await post();
    expect(r3.status).toBe(200); // a cancelled (never submitted) file frees its charges
    expect(await r3.text()).toContain("<SeqTp>RCUR</SeqTp>");
  });

  it("journals mandate and deposit changes with the acting user", async () => {
    const { bookAs } = await import("@/server/ledger");
    const m = await prisma.sepaMandate.findFirstOrThrow({ where: { tenantId } });
    await bookAs({ id: session.user.id, name: "Lena Hartmann" }, (t) => t.sepaMandate.update({ where: { id: m.id }, data: { active: false } }));
    const row = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, entity: "SepaMandate", entityId: m.id }, orderBy: { createdAt: "desc" } });
    expect(row).toMatchObject({ userName: "Lena Hartmann", source: "ui", action: "UPDATE" });
  });
});
