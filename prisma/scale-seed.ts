// nexrees: synthetic large-portfolio dataset for load and performance tests.
//
//   SCALE_UNITS=2000 SCALE_YEARS=3 npx tsx prisma/scale-seed.ts
//
// By default creates ONE new tenant ("Scale Test Hausverwaltung", isDemo=false) with roughly SCALE_UNITS units
// and SCALE_YEARS years of history across every area of the app: properties (rental + WEG),
// buildings, units, owners, renters, leases with components/deposits/adjustments, monthly charges,
// bank payments (on time, late, missing), dunning, meters + readings, cost entries, tickets,
// contractors, maintenance contracts, documents (metadata only, no files), WEG meetings,
// resolutions, economic plans, reserves, appointments, tasks, emails, letters, audit log,
// notifications, insurances and property tax.
//
// SCALE_TENANT="NexRees" loads the data into that existing tenant instead (e.g. staging, so every
// staff login sees it). Its users then act as assignees; no extra logins are created.
//
// Deterministic (fixed PRNG seed), so runs are comparable. Refuses to run in production (see
// seed-guard.ts). Every row it creates has an id starting with "sc" (cuids start with "c"), so
// SCALE_RESET=1 (with the same SCALE_TENANT, if used) removes exactly the generated rows and
// nothing else; in the default mode it also removes the test tenant.
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedAllowed } from "./seed-guard";

const TENANT_NAME = "Scale Test Hausverwaltung";
const INTO = process.env.SCALE_TENANT?.trim() || ""; // load into this existing tenant instead
export const SCALE_ADMIN_EMAIL = "scale-admin@nexrees.test";

if (!seedAllowed(process.env)) {
  throw new Error("scale-seed: refuses to run against production (APP_ENV=production, or NODE_ENV=production without APP_ENV)");
}

const prisma = new PrismaClient();
const UNITS = Math.max(10, Number(process.env.SCALE_UNITS ?? 2000));
const YEARS = Math.min(10, Math.max(1, Number(process.env.SCALE_YEARS ?? 3)));
const CHUNK = 5000;

// --- deterministic helpers ---
let seed = 0x2f6e2b1;
function rnd() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const money = (n: number) => new Prisma.Decimal(n.toFixed(2));
let idc = 0;
const RUN = Date.now().toString(36);
const id = () => `sc${RUN}${(idc++).toString(36).padStart(7, "0")}`;
const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const addMonths = (d: Date, n: number) => utc(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());

const FIRST = ["Anna", "Ben", "Clara", "David", "Elif", "Felix", "Greta", "Hannah", "Ismail", "Jonas", "Katharina", "Lukas", "Mia", "Noah", "Olga", "Paul", "Rana", "Sophie", "Tim", "Yusuf", "Zeynep", "Marie", "Leon", "Emma"];
const LAST = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Yılmaz", "Kaya", "Nowak", "Schröder", "Neumann", "Braun"];
const STREETS = ["Hauptstraße", "Bahnhofstraße", "Gartenweg", "Lindenallee", "Schillerstraße", "Goethestraße", "Am Markt", "Ringstraße", "Kirchgasse", "Mainufer"];
const CITIES: [string, string][] = [["60311", "Frankfurt am Main"], ["65183", "Wiesbaden"], ["55116", "Mainz"], ["64283", "Darmstadt"], ["63065", "Offenbach"], ["61348", "Bad Homburg"]];
const TRADES = ["Sanitär", "Elektro", "Heizung", "Dach", "Maler", "Garten", "Reinigung", "Aufzug", "Schlüsseldienst", "Schornsteinfeger"];
const COSTS = ["GRUNDSTEUER", "WASSER", "ENTWAESSERUNG", "HEIZUNG", "WARMWASSER", "MUELL", "GEBAEUDEREINIGUNG", "GARTENPFLEGE", "BELEUCHTUNG", "VERSICHERUNG", "HAUSWART", "SCHORNSTEIN"] as const;

type Row = Record<string, unknown>;
const buf: Record<string, Row[]> = {};
const push = (model: string, row: Row) => (buf[model] ??= []).push(row);

async function flush(model: string) {
  const rows = buf[model] ?? [];
  const delegate = (prisma as unknown as Record<string, { createMany(a: { data: Row[] }): Promise<unknown> }>)[model];
  for (let i = 0; i < rows.length; i += CHUNK) await delegate.createMany({ data: rows.slice(i, i + CHUNK) });
  console.log(`  ${model.padEnd(20)} ${rows.length}`);
  buf[model] = [];
}

// Children before parents; every generated id starts with ID_PREFIX.
const ID_PREFIX = "sc";
const RESET_ORDER = [
  "dunningNotice", "payment", "charge", "renter", "owner", "rentComponent", "rentAdjustment", "deposit", "lease",
  "meterReading", "meter", "ticket", "document", "appointment", "agendaItem", "resolution", "meeting",
  "reserveTransaction", "reserve", "economicPlan", "costEntry", "maintenanceContract", "insurance", "propertyTax",
  "unit", "building", "property", "sepaMandate", "person", "account", "contractor", "task", "emailMessage",
  "letter", "auditLog", "notification", "user",
];

async function reset() {
  const tenants = INTO
    ? await prisma.tenant.findMany({ where: { name: INTO }, select: { id: true } })
    : await prisma.tenant.findMany({ where: { name: TENANT_NAME }, select: { id: true } });
  if (INTO && tenants.length !== 1) throw new Error(`SCALE_TENANT "${INTO}": expected exactly one tenant, found ${tenants.length}`);
  for (const t of tenants) {
    // nexrees: generated test data is purged, not journaled, and ignores the period lock
    // (DB triggers of migration 20261109210000_nexrees_bookkeeping_integrity).
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
        for (const model of RESET_ORDER) {
          const delegate = (tx as unknown as Record<string, { deleteMany(a: unknown): Promise<{ count: number }> }>)[model];
          const r = await delegate.deleteMany({ where: { tenantId: t.id, id: { startsWith: ID_PREFIX } } });
          if (r.count) console.log(`  removed ${model.padEnd(20)} ${r.count}`);
        }
        if (!INTO) await tx.tenant.delete({ where: { id: t.id } });
      },
      { timeout: 600_000, maxWait: 30_000 },
    );
  }
  console.log(INTO ? `removed the generated data from "${INTO}"` : `removed ${tenants.length} scale tenant(s)`);
}

async function main() {
  if (process.env.SCALE_RESET === "1") return reset();
  let existing: { id: string } | null = null;
  if (INTO) {
    const found = await prisma.tenant.findMany({ where: { name: INTO }, select: { id: true } });
    if (found.length !== 1) throw new Error(`SCALE_TENANT "${INTO}": expected exactly one tenant, found ${found.length}`);
    existing = found[0];
    if (await prisma.property.findFirst({ where: { tenantId: existing.id, id: { startsWith: ID_PREFIX } } })) {
      throw new Error(`"${INTO}" already has generated data. Run with SCALE_RESET=1 first.`);
    }
  } else if (await prisma.tenant.findFirst({ where: { name: TENANT_NAME } })) {
    throw new Error(`"${TENANT_NAME}" exists already. Run with SCALE_RESET=1 first.`);
  }
  const t0 = Date.now();
  const now = new Date();
  const endMonth = utc(now.getUTCFullYear(), now.getUTCMonth()); // current month
  const startMonth = addMonths(endMonth, -12 * YEARS + 1);
  console.log(`scale-seed: ~${UNITS} units, ${YEARS} year(s) from ${startMonth.toISOString().slice(0, 7)}`);

  const tenantId = existing?.id ?? id();
  if (!existing) {
    await prisma.tenant.create({ data: { id: tenantId, name: TENANT_NAME, address: "Mainzer Landstraße 1\n60329 Frankfurt am Main" } });
  }

  // --- users: in an existing tenant its own users act as assignees, no extra logins ---
  const userIds: string[] = [];
  if (existing) {
    userIds.push(...(await prisma.user.findMany({ where: { tenantId }, select: { id: true } })).map((u) => u.id));
    if (userIds.length === 0) throw new Error(`"${INTO}" has no users`);
  } else {
  const pw = await bcrypt.hash(process.env.SCALE_ADMIN_PASSWORD ?? "scale-test", 10);
  const staff = [
    { email: SCALE_ADMIN_EMAIL, name: "Scale Admin", role: "ADMIN" },
    ...Array.from({ length: 12 }, (_, i) => ({ email: `verwalter${i + 1}@nexrees.test`, name: `Verwalter ${i + 1}`, role: "VERWALTER" })),
    ...Array.from({ length: 4 }, (_, i) => ({ email: `buchhaltung${i + 1}@nexrees.test`, name: `Buchhaltung ${i + 1}`, role: "BUCHHALTUNG" })),
  ];
  for (const s of staff) {
    const uid = id();
    userIds.push(uid);
    push("user", { id: uid, tenantId, email: s.email, name: s.name, role: s.role, passwordHash: pw });
  }
  await flush("user");
  }

  // --- contractors ---
  const contractorIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const cid = id();
    contractorIds.push(cid);
    push("contractor", { id: cid, tenantId, name: `${pick(LAST)} ${pick(TRADES)} GmbH`, trade: pick(TRADES), email: `kontakt${i}@handwerk.test`, phone: `069 ${int(100000, 999999)}` });
  }
  await flush("contractor");

  // --- properties / buildings / units / owners ---
  type U = { id: string; propertyId: string; area: number; weg: boolean; label: string };
  const units: U[] = [];
  const properties: { id: string; weg: boolean; accountId: string; unitIds: string[]; ownerPersonIds: string[] }[] = [];
  const persons: { id: string; name: string; iban: string }[] = [];
  const mkPerson = (type: string, company = false) => {
    const pid = id();
    const firstName = company ? pick(["Immobilien", "Grundbesitz", "Wohnbau", "Vermögensverwaltung"]) : pick(FIRST);
    const lastName = company ? `${pick(LAST)} ${pick(["GmbH", "GmbH & Co. KG", "AG", "GbR"])}` : pick(LAST);
    const iban = `DE${int(10, 99)}5005${String(int(0, 99999999)).padStart(8, "0")}${String(int(0, 999999)).padStart(6, "0")}`;
    persons.push({ id: pid, name: `${firstName} ${lastName}`, iban });
    push("person", { id: pid, tenantId, firstName, lastName, type, email: `p${pid.slice(-6)}@mail.test`, phone: chance(0.6) ? `0151 ${int(1000000, 9999999)}` : null, iban, accountHolder: `${firstName} ${lastName}`, address: `${pick(STREETS)} ${int(1, 120)}\n${pick(CITIES).join(" ")}` });
    return pid;
  };

  let made = 0;
  let pIdx = 0;
  while (made < UNITS) {
    const weg = chance(0.35);
    const size = Math.min(UNITS - made, weg ? int(8, 60) : int(4, 90));
    const propertyId = id();
    const [zip, city] = pick(CITIES);
    const accountId = id();
    push("property", { id: propertyId, tenantId, name: `${weg ? "WEG " : ""}${pick(STREETS)} ${int(1, 200)}`, street: `${pick(STREETS)} ${int(1, 200)}`, zip, city, type: chance(0.1) ? "GEMISCHT" : "WOHNEN", management: weg ? "WEG" : "MIET", feeType: chance(0.5) ? "PRO_EINHEIT" : "PAUSCHAL", feeValue: money(weg ? 28 : 450) });
    push("account", { id: accountId, tenantId, name: `Objektkonto ${pIdx + 1}`, type: "BANK", iban: `DE${int(10, 99)}50050201${String(int(0, 9999999999)).padStart(10, "0")}` });
    const prop = { id: propertyId, weg, accountId, unitIds: [] as string[], ownerPersonIds: [] as string[] };
    const buildings = size > 30 ? int(2, 4) : 1;
    const bIds = Array.from({ length: buildings }, (_, b) => {
      const bid = id();
      push("building", { id: bid, tenantId, propertyId, name: buildings > 1 ? `Haus ${String.fromCharCode(65 + b)}` : "Hauptgebäude" });
      return bid;
    });
    const mietOwner = weg ? null : mkPerson("EIGENTUEMER", chance(0.6));
    if (mietOwner) prop.ownerPersonIds.push(mietOwner);
    for (let u = 0; u < size; u++) {
      const uid = id();
      const area = int(28, 140);
      const label = `${bIds.length > 1 ? String.fromCharCode(65 + (u % bIds.length)) : ""}WE ${String(u + 1).padStart(2, "0")}`;
      push("unit", { id: uid, tenantId, buildingId: bIds[u % bIds.length], label, type: chance(0.06) ? "GEWERBE" : chance(0.05) ? "STELLPLATZ" : "WOHNUNG", area: money(area), rooms: new Prisma.Decimal(Math.max(1, Math.round(area / 25))), mea: weg ? Math.round((1000 / size) * 100) / 100 : null });
      const ownerId = weg ? mkPerson("EIGENTUEMER", chance(0.1)) : (mietOwner as string);
      if (weg) prop.ownerPersonIds.push(ownerId);
      push("owner", { id: id(), tenantId, personId: ownerId, unitId: uid, share: 1000 });
      units.push({ id: uid, propertyId, area, weg, label });
      prop.unitIds.push(uid);
    }
    properties.push(prop);
    made += size;
    pIdx++;
  }
  // reserve + deposit accounts
  const kautionAccount = id();
  push("account", { id: kautionAccount, tenantId, name: "Kautionskonto Sammel", type: "KAUTION" });
  await flush("property");
  await flush("account");
  await flush("building");
  await flush("person");
  await flush("unit");
  await flush("owner");

  // --- leases (current + history), renters, components, deposits, adjustments, charges, payments, dunning ---
  let charges = 0;
  for (const u of units) {
    // WEG units: about half are rented out by their owner
    if (u.weg && chance(0.5)) continue;
    let start = addMonths(startMonth, -int(0, 60));
    while (start <= endMonth) {
      const len = int(18, 96);
      const endRaw = addMonths(start, len);
      const ended = endRaw <= endMonth;
      const leaseId = id();
      const cold = Math.round(u.area * (9 + rnd() * 8));
      const nk = Math.round(u.area * 2.2);
      const hk = Math.round(u.area * 1.3);
      push("lease", { id: leaseId, tenantId, unitId: u.id, startDate: start, endDate: ended ? addMonths(endRaw, 0) : null, rentCold: money(cold), personCount: int(1, 4), noticePeriodM: 3 });
      push("rentComponent", { id: id(), tenantId, leaseId, type: "NEBENKOSTEN", amount: money(nk) });
      push("rentComponent", { id: id(), tenantId, leaseId, type: "HEIZKOSTEN", amount: money(hk) });
      if (chance(0.25)) push("rentAdjustment", { id: id(), tenantId, leaseId, type: chance(0.5) ? "INDEX" : "STAFFEL", effectiveDate: addMonths(start, 12), newRentCold: money(cold * 1.03), applied: addMonths(start, 12) <= endMonth });
      push("deposit", { id: id(), tenantId, leaseId, type: chance(0.7) ? "KAUTIONSKONTO" : "BUERGSCHAFT", amount: money(cold * 3), accountId: kautionAccount, receivedDate: start, returnedDate: ended ? addMonths(endRaw, 3) : null });
      const renterCount = chance(0.35) ? 2 : 1;
      const renterIds = Array.from({ length: renterCount }, () => mkPerson("MIETER"));
      for (const pid of renterIds) push("renter", { id: id(), tenantId, personId: pid, leaseId });
      const payer = persons[persons.length - renterCount];
      const payAccount = properties.find((p) => p.id === u.propertyId)!.accountId;
      const late = chance(0.08); // chronically late payer
      for (let m = start < startMonth ? startMonth : start; m <= endMonth && (!ended || m < endRaw); m = addMonths(m, 1)) {
        const chargeId = id();
        const due = utc(m.getUTCFullYear(), m.getUTCMonth(), 3);
        const warm = cold + nk + hk;
        push("charge", { id: chargeId, tenantId, leaseId, type: "MIETE", period: m, dueDate: due, amount: money(warm), description: `Miete ${m.toISOString().slice(0, 7)}` });
        charges++;
        const isCurrent = m.getTime() === endMonth.getTime();
        const r = rnd();
        if (isCurrent && r < 0.4) continue; // current month not yet fully paid
        if (r < (late ? 0.12 : 0.015)) {
          // unpaid → dunning
          const age = (endMonth.getTime() - m.getTime()) / 2.6e9;
          for (let lvl = 1; lvl <= Math.min(3, Math.floor(age)); lvl++) push("dunningNotice", { id: id(), tenantId, chargeId, level: lvl, date: addMonths(due, lvl), fee: money(lvl > 1 ? 5 : 0) });
          continue;
        }
        const partial = chance(late ? 0.15 : 0.01);
        push("payment", { id: id(), tenantId, accountId: payAccount, chargeId, date: utc(m.getUTCFullYear(), m.getUTCMonth(), late ? int(5, 25) : int(1, 4)), amount: money(partial ? warm / 2 : warm), direction: "EINGANG", reference: `Miete ${u.label} ${m.toISOString().slice(0, 7)}`, counterparty: payer.name, counterpartyIban: payer.iban, externalId: `tx-${chargeId}` });
      }
      start = ended ? addMonths(endRaw, int(0, 3)) : addMonths(endMonth, 1);
    }
    if (buf.charge && buf.charge.length > 50_000) {
      // keep memory bounded: write parents first, then the rows that point at them
      for (const m of ["person", "lease", "rentComponent", "rentAdjustment", "deposit", "renter", "charge", "payment", "dunningNotice"]) await flush(m);
    }
  }
  for (const m of ["person", "lease", "rentComponent", "rentAdjustment", "deposit", "renter", "charge", "payment", "dunningNotice"]) await flush(m);

  // --- SEPA mandates, outgoing payments (invoices) ---
  for (const p of persons.slice(0, Math.floor(persons.length * 0.4))) push("sepaMandate", { id: id(), tenantId, personId: p.id, iban: p.iban, mandateRef: `M-${p.id.slice(-8)}`, signedDate: startMonth });
  await flush("sepaMandate");
  for (const p of properties) {
    for (let m = startMonth; m <= endMonth; m = addMonths(m, 1)) {
      for (let k = 0; k < int(2, 6); k++) push("payment", { id: id(), tenantId, accountId: p.accountId, date: utc(m.getUTCFullYear(), m.getUTCMonth(), int(1, 28)), amount: money(int(80, 4000)), direction: "AUSGANG", reference: `Rechnung ${int(1000, 99999)}`, counterparty: `${pick(LAST)} ${pick(TRADES)} GmbH` });
    }
  }
  await flush("payment");

  // --- meters + readings ---
  for (const u of units) {
    for (const type of ["WASSER_KALT", "WASSER_WARM", "WAERME"]) {
      const mid = id();
      push("meter", { id: mid, tenantId, unitId: u.id, type, serialNo: `${type.slice(0, 2)}-${int(100000, 999999)}` });
      let v = rnd() * 100;
      for (let y = 0; y <= YEARS; y++) {
        v += type === "WAERME" ? u.area * 80 : u.area * 0.4;
        push("meterReading", { id: id(), tenantId, meterId: mid, date: utc(startMonth.getUTCFullYear() + y, 11, 31), value: new Prisma.Decimal(v.toFixed(3)) });
      }
    }
  }
  await flush("meter");
  await flush("meterReading");

  // --- per-property: costs, maintenance, insurance, tax, WEG artefacts, documents, tickets, appointments ---
  const firstYear = startMonth.getUTCFullYear();
  const lastYear = endMonth.getUTCFullYear();
  for (const p of properties) {
    const n = p.unitIds.length;
    for (let y = firstYear; y <= lastYear; y++) {
      for (const c of COSTS) push("costEntry", { id: id(), tenantId, propertyId: p.id, year: y, type: c, amount: money(n * int(40, 400)), method: c === "HEIZUNG" || c === "WARMWASSER" ? "CONSUMPTION" : p.weg ? "MEA" : "AREA", umlagefaehig: true });
      if (p.weg) {
        push("economicPlan", { id: id(), tenantId, propertyId: p.id, year: y, totalAmount: money(n * 3200) });
        const meetingId = id();
        push("meeting", { id: meetingId, tenantId, propertyId: p.id, title: `Eigentümerversammlung ${y}`, date: utc(y, 5, int(1, 28)), status: utc(y, 5, 28) < now ? "DURCHGEFUEHRT" : "GEPLANT", location: "Gemeinschaftsraum", protocol: "Protokoll (synthetisch)" });
        for (let a = 1; a <= 6; a++) push("agendaItem", { id: id(), tenantId, meetingId, position: a, title: `TOP ${a}` });
        for (let r = 1; r <= 4; r++) push("resolution", { id: id(), tenantId, propertyId: p.id, meetingId, number: (y - firstYear) * 4 + r, title: `Beschluss ${y}/${r}`, text: "Synthetischer Beschlusstext.", date: utc(y, 5, 28), result: pick(["ANGENOMMEN", "ANGENOMMEN", "ABGELEHNT", "VERTAGT"]), votesYes: int(0, n), votesNo: int(0, n / 3), votesAbstain: int(0, 3) });
      }
    }
    if (p.weg) {
      const reserveId = id();
      push("reserve", { id: reserveId, tenantId, propertyId: p.id, name: "Erhaltungsrücklage" });
      for (let m = startMonth; m <= endMonth; m = addMonths(m, 1)) push("reserveTransaction", { id: id(), tenantId, reserveId, date: m, amount: money(n * 25) });
    }
    for (let k = 0; k < 3; k++) push("maintenanceContract", { id: id(), tenantId, propertyId: p.id, contractorId: pick(contractorIds), title: pick(["Aufzugswartung", "Heizungswartung", "Rauchmelderprüfung", "Dachrinnenreinigung"]), intervalMonths: pick([6, 12, 24]), nextDue: addMonths(endMonth, int(-2, 12)) });
    push("insurance", { id: id(), tenantId, propertyId: p.id, type: "GEBAEUDE", insurer: "Muster Versicherung AG", policyNo: `GV-${int(10000, 99999)}`, premium: money(n * 180) });
    push("propertyTax", { id: id(), tenantId, propertyId: p.id, aktenzeichen: `${int(100, 999)}/${int(100, 999)}/${int(1000, 9999)}`, hebesatz: new Prisma.Decimal(500) });
    // documents: contracts per unit + invoices per month (metadata only, storage key points nowhere)
    for (const uid of p.unitIds) push("document", { id: id(), tenantId, propertyId: p.id, unitId: uid, name: "Mietvertrag.pdf", category: "VERTRAG", mime: "application/pdf", size: int(80_000, 900_000), storageKey: `scale/${id()}.pdf` });
    for (let m = startMonth; m <= endMonth; m = addMonths(m, 1)) push("document", { id: id(), tenantId, propertyId: p.id, name: `Rechnung ${m.toISOString().slice(0, 7)}.pdf`, category: "RECHNUNG", mime: "application/pdf", size: int(30_000, 300_000), storageKey: `scale/${id()}.pdf`, createdAt: m });
    // tickets: ~0.6 per unit per year
    for (let k = 0; k < Math.round(n * 0.6 * YEARS); k++) {
      const created = addMonths(startMonth, int(0, 12 * YEARS - 1));
      const old = created < addMonths(endMonth, -2);
      push("ticket", { id: id(), tenantId, propertyId: p.id, unitId: pick(p.unitIds), contractorId: chance(0.6) ? pick(contractorIds) : null, assigneeId: pick(userIds), title: pick(["Heizung kalt", "Wasserschaden Bad", "Klingel defekt", "Fenster undicht", "Schimmel", "Treppenhauslicht"]), category: pick(["STOERUNG", "SCHADEN", "WARTUNG", "SONSTIGES"]), status: old ? (chance(0.95) ? "ERLEDIGT" : "WARTEND") : pick(["OFFEN", "IN_ARBEIT", "WARTEND", "ERLEDIGT"]), priority: pick(["NIEDRIG", "MITTEL", "HOCH"]), createdAt: created, timeSpentMin: int(0, 240) });
    }
    for (let k = 0; k < 4 * YEARS; k++) push("appointment", { id: id(), tenantId, propertyId: p.id, title: pick(["Besichtigung", "Begehung", "Wartung", "Übergabe"]), type: pick(["BESICHTIGUNG", "WARTUNG", "SONSTIGES"]), start: addMonths(startMonth, int(0, 12 * YEARS + 2)) });
  }
  for (const m of ["costEntry", "economicPlan", "meeting", "agendaItem", "resolution", "reserve", "reserveTransaction", "maintenanceContract", "insurance", "propertyTax", "document", "ticket", "appointment"]) await flush(m);

  // --- office activity: tasks, emails, letters, audit, notifications ---
  const months = 12 * YEARS;
  for (let k = 0; k < months * 30; k++) push("task", { id: id(), tenantId, title: `Aufgabe ${k}`, dueDate: addMonths(startMonth, int(0, months)), done: chance(0.85) });
  for (let k = 0; k < months * 400; k++) {
    const p = pick(persons);
    push("emailMessage", { id: id(), tenantId, toAddress: `p${p.id.slice(-6)}@mail.test`, subject: pick(["Nebenkostenabrechnung", "Mieterhöhung", "Termin Handwerker", "Rückfrage Zahlung"]), body: "Synthetische Nachricht.", status: "GESENDET", sentAt: addMonths(startMonth, int(0, months - 1)), sentById: pick(userIds) });
  }
  for (let k = 0; k < months * 60; k++) {
    const p = pick(persons);
    push("letter", { id: id(), tenantId, personId: p.id, recipient: `${p.name}\nMusterstraße 1\n60311 Frankfurt`, subject: "Schreiben", body: "Synthetischer Brief.", status: pick(["VERSENDET", "ZUGESTELLT", "ENTWURF"]), sentAt: addMonths(startMonth, int(0, months - 1)) });
  }
  for (let k = 0; k < months * 4000; k++) push("auditLog", { id: id(), tenantId, userId: pick(userIds), userName: "Verwalter", action: pick(["CREATE", "UPDATE", "UPDATE", "DELETE"]), entity: pick(["Lease", "Payment", "Charge", "Ticket", "Person"]), entityId: id(), summary: "synthetisch", createdAt: new Date(startMonth.getTime() + rnd() * (now.getTime() - startMonth.getTime())) });
  if (!existing) for (const uid of userIds) for (let k = 0; k < 200; k++) push("notification", { id: id(), tenantId, userId: uid, title: "Schadensmeldung eingegangen", link: "/tickets", read: chance(0.9) });
  for (const m of ["task", "emailMessage", "letter", "auditLog", "notification"]) await flush(m);

  const s = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done in ${s}s: ${units.length} units, ${properties.length} properties, ${persons.length} persons, ${charges} charges. ${existing ? `Tenant: ${INTO}` : `Login: ${SCALE_ADMIN_EMAIL}`}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
