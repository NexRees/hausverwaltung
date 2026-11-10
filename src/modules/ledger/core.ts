// Copyright (c) 2026 NexRees.
//
// Ledger core: double-entry journal, chart of accounts, balances, Storno, chain verification and
// the DATEV row mapping. This file imports nothing from the host application. It talks to the
// database through the small `LedgerDb` port and to the SQL functions of the migration
// 20261110160000_nexrees_ledger_core. The host glue is in ./havewa.ts.

/** Port to the database: one parameterised SQL statement ($1, $2, …), rows back. */
export interface LedgerDb {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type LedgerAccount = {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  key: string | null;
  datevNumber: string | null;
};

export type JournalLine = {
  position: number;
  accountId: string;
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  leaseId: string | null;
  personId: string | null;
};

export type JournalEntry = {
  id: string;
  seq: number;
  date: string; // YYYY-MM-DD
  text: string;
  propertyId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  kind: "BOOKING" | "STORNO";
  reversesId: string | null;
  reversedById: string | null;
  userName: string | null;
  source: string | null;
  hash: string;
  createdAt: string;
  amount: number; // sum of the debit side
  lines: JournalLine[];
};

export type JournalFilter = {
  from?: string;
  to?: string;
  propertyId?: string;
  accountId?: string;
  q?: string;
  limit: number;
  offset: number;
};

export type BalanceRow = LedgerAccount & {
  opening: number; // balance before `from` (debit positive)
  debit: number; // turnover in the range
  credit: number;
  closing: number; // opening + debit - credit
};

export type ChainStatus = { entries: number; firstBadSeq: number | null; headSeq: number; headHash: string };

/** A refusal with a message people can act on (validation, immutable journal, closed period). */
export class LedgerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, code = "ledger_invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DB_CODES: Record<string, { code: string; status: number }> = {
  NEXREES_LEDGER_INVALID: { code: "ledger_invalid", status: 400 },
  NEXREES_LEDGER_UNBALANCED: { code: "ledger_unbalanced", status: 400 },
  NEXREES_LEDGER_IMMUTABLE: { code: "ledger_immutable", status: 409 },
  NEXREES_LEDGER_ACCOUNT: { code: "ledger_account", status: 400 },
  NEXREES_LEDGER_ACCOUNT_USED: { code: "ledger_account_used", status: 409 },
  NEXREES_PERIOD_LOCKED: { code: "period_locked", status: 409 },
};

/** Turns a refusal raised by the ledger's SQL functions into a LedgerError; null for anything else. */
export function ledgerErrorFrom(e: unknown): LedgerError | null {
  if (e instanceof LedgerError) return e;
  const text = e instanceof Error ? e.message : String(e ?? "");
  const m = /(NEXREES_(?:LEDGER_[A-Z_]+|PERIOD_LOCKED)): ([^\n`]+)/.exec(text);
  if (m) {
    const known = DB_CODES[m[1]] ?? DB_CODES.NEXREES_LEDGER_INVALID;
    if (m[1] === "NEXREES_PERIOD_LOCKED") {
      const p = /vom ([\d.]+) liegt im festgeschriebenen Zeitraum \(bis ([\d.]+)\)/.exec(m[2]);
      const msg = p
        ? `Buchung vom ${p[1]} liegt im festgeschriebenen Zeitraum (bis ${p[2]}) und kann nicht mehr gebucht werden. Korrekturen bitte im offenen Zeitraum erfassen.`
        : "Der Zeitraum ist festgeschrieben.";
      return new LedgerError(msg, known.code, known.status);
    }
    return new LedgerError(m[2].trim(), known.code, known.status);
  }
  if (/LedgerAccount_tenantId_number_key|Unique constraint.*number/.test(text)) {
    return new LedgerError("Diese Kontonummer ist bereits vergeben.", "ledger_account", 409);
  }
  return null;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw ledgerErrorFrom(e) ?? e;
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: unknown): s is string => typeof s === "string" && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const num = (v: unknown) => Number(v ?? 0);
const cents = (n: number) => Math.round(n * 100);

export type ManualEntryInput = {
  date: string; // YYYY-MM-DD
  text: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  propertyId?: string | null;
};

/** Checks a free journal entry before it reaches the database; returns field → message. */
export function manualEntryProblems(i: Partial<ManualEntryInput>): Record<string, string> {
  const p: Record<string, string> = {};
  if (!isDay(i.date)) p.date = "Bitte ein gültiges Buchungsdatum angeben.";
  if (!i.text || !i.text.trim()) p.text = "Bitte einen Buchungstext angeben.";
  else if (i.text.length > 500) p.text = "Der Buchungstext darf höchstens 500 Zeichen haben.";
  if (!i.debitAccountId) p.debitAccountId = "Bitte das Soll-Konto wählen.";
  if (!i.creditAccountId) p.creditAccountId = "Bitte das Haben-Konto wählen.";
  if (i.debitAccountId && i.debitAccountId === i.creditAccountId) p.creditAccountId = "Soll- und Haben-Konto müssen verschieden sein.";
  const a = Number(i.amount);
  if (!Number.isFinite(a) || a <= 0) p.amount = "Der Betrag muss größer als 0 sein.";
  else if (Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) p.amount = "Der Betrag darf höchstens zwei Nachkommastellen haben.";
  else if (a > 999_999_999_999.99) p.amount = "Der Betrag ist zu groß.";
  return p;
}

/** Posts a free entry (debit account an credit account). Returns the new entry's id. */
export async function postManualEntry(db: LedgerDb, tenantId: string, input: ManualEntryInput): Promise<string> {
  const problems = manualEntryProblems(input);
  const first = Object.values(problems)[0];
  if (first) throw new LedgerError(first);
  const amount = cents(input.amount) / 100;
  const lines = JSON.stringify([
    { id: input.debitAccountId, debit: amount },
    { id: input.creditAccountId, credit: amount },
  ]);
  const rows = await guarded(() =>
    db.query<{ id: string }>(
      `SELECT nexrees_ledger_post($1, $2::date, $3, $4, NULL, NULL, 'BOOKING', NULL, $5::jsonb) AS id`,
      tenantId,
      input.date,
      input.text.trim(),
      input.propertyId || null,
      lines,
    ),
  );
  return rows[0].id;
}

/**
 * Storno of a free entry. Entries that stand for a document (charge, payment, reserve movement)
 * are reversed by changing or deleting that document, so both always agree.
 */
export async function reverseManualEntry(db: LedgerDb, tenantId: string, entryId: string): Promise<string> {
  const found = await db.query<{ sourceTable: string | null }>(
    `SELECT "sourceTable" FROM "JournalEntry" WHERE "id" = $1 AND "tenantId" = $2`,
    entryId,
    tenantId,
  );
  if (!found.length) throw new LedgerError("Buchung nicht gefunden.", "not_found", 404);
  if (found[0].sourceTable) {
    throw new LedgerError(
      "Diese Buchung gehört zu einem Beleg (Sollstellung, Zahlung oder Rücklagenbuchung). Bitte den Beleg ändern oder löschen; das Storno entsteht dann automatisch.",
      "ledger_has_document",
      409,
    );
  }
  const rows = await guarded(() => db.query<{ id: string }>(`SELECT nexrees_ledger_reverse($1, $2) AS id`, tenantId, entryId));
  return rows[0].id;
}

/** Chart of accounts; the default accounts are created on first call. */
export async function listAccounts(db: LedgerDb, tenantId: string): Promise<LedgerAccount[]> {
  await db.query(`SELECT nexrees_ledger_ensure_chart($1)::text AS "ok"`, tenantId);
  return db.query<LedgerAccount>(
    `SELECT "id", "number", "name", "type"::text AS "type", "key", "datevNumber"
       FROM "LedgerAccount" WHERE "tenantId" = $1 ORDER BY "number", "id"`,
    tenantId,
  );
}

export type AccountInput = { number: string; name: string; type?: AccountType; datevNumber?: string | null };

export function accountProblems(i: Partial<AccountInput>, needType: boolean): Record<string, string> {
  const p: Record<string, string> = {};
  const number = (i.number ?? "").trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/.test(number)) p.number = "Kontonummer: 1 bis 20 Zeichen (Ziffern, Buchstaben, Punkt, Bindestrich).";
  const name = (i.name ?? "").trim();
  if (!name) p.name = "Bitte eine Bezeichnung angeben.";
  else if (name.length > 120) p.name = "Die Bezeichnung darf höchstens 120 Zeichen haben.";
  if (needType && !ACCOUNT_TYPES.includes(i.type as AccountType)) p.type = "Bitte die Kontoart wählen.";
  const datev = (i.datevNumber ?? "").trim();
  if (datev && !/^[0-9]{4,9}$/.test(datev)) p.datevNumber = "DATEV-Konto: 4 bis 9 Ziffern.";
  return p;
}

export async function createAccount(db: LedgerDb, tenantId: string, input: AccountInput): Promise<string> {
  const first = Object.values(accountProblems(input, true))[0];
  if (first) throw new LedgerError(first);
  const rows = await guarded(() =>
    db.query<{ id: string }>(
      `INSERT INTO "LedgerAccount" ("id", "tenantId", "number", "name", "type", "datevNumber")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::"LedgerAccountType", $5) RETURNING "id"`,
      tenantId,
      input.number.trim(),
      input.name.trim(),
      input.type,
      input.datevNumber?.trim() || null,
    ),
  );
  return rows[0].id;
}

/** Number, name and DATEV number can change at any time; type and role cannot once booked. */
export async function updateAccount(db: LedgerDb, tenantId: string, id: string, input: AccountInput): Promise<void> {
  const first = Object.values(accountProblems(input, false))[0];
  if (first) throw new LedgerError(first);
  const rows = await guarded(() =>
    db.query<{ id: string }>(
      `UPDATE "LedgerAccount" SET "number" = $3, "name" = $4, "datevNumber" = $5
        WHERE "id" = $1 AND "tenantId" = $2 RETURNING "id"`,
      id,
      tenantId,
      input.number.trim(),
      input.name.trim(),
      input.datevNumber?.trim() || null,
    ),
  );
  if (!rows.length) throw new LedgerError("Konto nicht gefunden.", "not_found", 404);
}

function journalWhere(tenantId: string, f: Omit<JournalFilter, "limit" | "offset">) {
  const params: unknown[] = [tenantId];
  const cond = [`e."tenantId" = $1`];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (f.from && isDay(f.from)) add(`e."date" >= ?::date`, f.from);
  if (f.to && isDay(f.to)) add(`e."date" <= ?::date`, f.to);
  if (f.propertyId) add(`e."propertyId" = ?`, f.propertyId);
  if (f.accountId) add(`EXISTS (SELECT 1 FROM "JournalLine" x WHERE x."entryId" = e."id" AND x."accountId" = ?)`, f.accountId);
  const q = f.q?.trim();
  if (q) {
    params.push(q.replace(/[\\%_]/g, "\\$&"));
    const n = `$${params.length}`;
    cond.push(/^\d{1,9}$/.test(q) ? `(e."seq" = ${n}::int OR e."text" ILIKE '%' || ${n} || '%')` : `e."text" ILIKE '%' || ${n} || '%'`);
  }
  return { where: cond.join(" AND "), params };
}

/** Journal, newest first, with the lines of every entry. */
export async function listJournal(db: LedgerDb, tenantId: string, f: JournalFilter): Promise<{ items: JournalEntry[]; total: number }> {
  const { where, params } = journalWhere(tenantId, f);
  const limit = Math.max(1, Math.min(5000, Math.trunc(f.limit) || 50));
  const offset = Math.max(0, Math.trunc(f.offset) || 0);
  const [count, rows] = await Promise.all([
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" e WHERE ${where}`, ...params),
    db.query<Record<string, unknown>>(
      `SELECT e."id", e."seq", to_char(e."date", 'YYYY-MM-DD') AS "date", e."text", e."propertyId", e."sourceTable", e."sourceId",
              e."kind"::text AS "kind", e."reversesId", r."id" AS "reversedById", e."userName", e."source", e."hash",
              to_char(e."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
              (SELECT jsonb_agg(jsonb_build_object(
                        'position', l."position", 'accountId', l."accountId", 'accountNumber', a."number", 'accountName', a."name",
                        'debit', l."debit", 'credit', l."credit", 'leaseId', l."leaseId", 'personId', l."personId") ORDER BY l."position")
                 FROM "JournalLine" l JOIN "LedgerAccount" a ON a."id" = l."accountId" WHERE l."entryId" = e."id") AS "lines"
         FROM "JournalEntry" e LEFT JOIN "JournalEntry" r ON r."reversesId" = e."id"
        WHERE ${where}
        ORDER BY e."seq" DESC LIMIT ${limit} OFFSET ${offset}`,
      ...params,
    ),
  ]);
  const items = rows.map((r) => {
    const lines = ((r.lines as Record<string, unknown>[] | null) ?? []).map((l) => ({
      position: num(l.position),
      accountId: String(l.accountId),
      accountNumber: String(l.accountNumber),
      accountName: String(l.accountName),
      debit: num(l.debit),
      credit: num(l.credit),
      leaseId: (l.leaseId as string | null) ?? null,
      personId: (l.personId as string | null) ?? null,
    }));
    return {
      id: String(r.id),
      seq: num(r.seq),
      date: String(r.date),
      text: String(r.text),
      propertyId: (r.propertyId as string | null) ?? null,
      sourceTable: (r.sourceTable as string | null) ?? null,
      sourceId: (r.sourceId as string | null) ?? null,
      kind: r.kind as "BOOKING" | "STORNO",
      reversesId: (r.reversesId as string | null) ?? null,
      reversedById: (r.reversedById as string | null) ?? null,
      userName: (r.userName as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      hash: String(r.hash),
      createdAt: String(r.createdAt),
      amount: cents(lines.reduce((s, l) => s + l.debit, 0)) / 100,
      lines,
    };
  });
  return { items, total: count[0]?.n ?? 0 };
}

/**
 * Summen- und Saldenliste: per account the balance before `from`, the turnover in the range and
 * the closing balance (debit positive). Optionally for one property.
 */
export async function trialBalance(
  db: LedgerDb,
  tenantId: string,
  f: { from?: string; to?: string; propertyId?: string } = {},
): Promise<BalanceRow[]> {
  const from = f.from && isDay(f.from) ? f.from : null;
  const to = f.to && isDay(f.to) ? f.to : null;
  const rows = await db.query<Record<string, unknown>>(
    `SELECT a."id", a."number", a."name", a."type"::text AS "type", a."key", a."datevNumber",
            coalesce(sum(l."debit" - l."credit") FILTER (WHERE $2::date IS NOT NULL AND l."date" < $2::date), 0) AS "opening",
            coalesce(sum(l."debit") FILTER (WHERE ($2::date IS NULL OR l."date" >= $2::date) AND ($3::date IS NULL OR l."date" <= $3::date)), 0) AS "debit",
            coalesce(sum(l."credit") FILTER (WHERE ($2::date IS NULL OR l."date" >= $2::date) AND ($3::date IS NULL OR l."date" <= $3::date)), 0) AS "credit"
       FROM "LedgerAccount" a
       LEFT JOIN (SELECT x."accountId", x."debit", x."credit", j."date"
                    FROM "JournalLine" x JOIN "JournalEntry" j ON j."id" = x."entryId"
                   WHERE x."tenantId" = $1 AND ($4::text IS NULL OR j."propertyId" = $4)) l ON l."accountId" = a."id"
      WHERE a."tenantId" = $1
      GROUP BY a."id" ORDER BY a."number", a."id"`,
    tenantId,
    from,
    to,
    f.propertyId || null,
  );
  return rows.map((r) => {
    const opening = num(r.opening);
    const debit = num(r.debit);
    const credit = num(r.credit);
    return {
      id: String(r.id),
      number: String(r.number),
      name: String(r.name),
      type: r.type as AccountType,
      key: (r.key as string | null) ?? null,
      datevNumber: (r.datevNumber as string | null) ?? null,
      opening,
      debit,
      credit,
      closing: cents(opening + debit - credit) / 100,
    };
  });
}

/** Recomputes the hash chain of a company's journal. */
export async function verifyChain(db: LedgerDb, tenantId: string): Promise<ChainStatus> {
  const rows = await db.query<Record<string, unknown>>(`SELECT * FROM nexrees_ledger_verify($1)`, tenantId);
  const r = rows[0] ?? {};
  return {
    entries: num(r.entries),
    firstBadSeq: r.firstBadSeq == null ? null : num(r.firstBadSeq),
    headSeq: num(r.headSeq),
    headHash: String(r.headHash ?? ""),
  };
}

/** Number of entries and the hash of the last one, without recomputing the chain. */
export async function chainHead(db: LedgerDb, tenantId: string): Promise<{ headSeq: number; headHash: string }> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT "seq", "hash" FROM "JournalEntry" WHERE "tenantId" = $1 ORDER BY "seq" DESC LIMIT 1`,
    tenantId,
  );
  return { headSeq: num(rows[0]?.seq), headHash: String(rows[0]?.hash ?? "") };
}

// ---------- DATEV ----------

/** One row of a DATEV Buchungsstapel (same shape the host's EXTF writer takes). */
export type DatevBooking = {
  amount: number;
  debitCredit: "S" | "H";
  account: string;
  contraAccount: string;
  date: string;
  text: string;
  invoiceField?: string;
};

const DATEV_ACCOUNT = /^[0-9]{4,9}$/;

type DatevLine = { debit: number; credit: number; number: string };

/**
 * Journal entry → DATEV rows. An entry with one debit and one credit line is one row (debit
 * account "S" against the credit account). An entry with several lines on one side is split
 * against the single line of the other side; several lines on both sides cannot be expressed
 * in a Buchungsstapel row and are reported in `skipped`.
 */
export function datevRowsForEntry(e: { seq: number; date: string; text: string; lines: DatevLine[] }): DatevBooking[] | null {
  const debit = e.lines.filter((l) => l.debit > 0);
  const credit = e.lines.filter((l) => l.credit > 0);
  const row = (amount: number, account: string, contra: string): DatevBooking => ({
    amount,
    debitCredit: "S",
    account,
    contraAccount: contra,
    date: e.date,
    text: e.text.slice(0, 60),
    invoiceField: String(e.seq),
  });
  if (debit.length === 1) return credit.map((c) => row(c.credit, debit[0].number, c.number));
  if (credit.length === 1) return debit.map((d) => row(d.debit, d.number, credit[0].number));
  return null;
}

/** Bookings of a calendar year for the DATEV export, in journal order. */
export async function datevBookings(db: LedgerDb, tenantId: string, year: number): Promise<{ rows: DatevBooking[]; skipped: number[] }> {
  const entries = await db.query<{ seq: number; date: string; text: string; lines: { debit: unknown; credit: unknown; number: string }[] }>(
    `SELECT e."seq", to_char(e."date", 'YYYY-MM-DD') AS "date", e."text",
            (SELECT jsonb_agg(jsonb_build_object('debit', l."debit", 'credit', l."credit", 'number', coalesce(a."datevNumber", a."number")) ORDER BY l."position")
               FROM "JournalLine" l JOIN "LedgerAccount" a ON a."id" = l."accountId" WHERE l."entryId" = e."id") AS "lines"
       FROM "JournalEntry" e
      WHERE e."tenantId" = $1 AND e."date" >= make_date($2::int, 1, 1) AND e."date" <= make_date($2::int, 12, 31)
      ORDER BY e."seq"`,
    tenantId,
    year,
  );
  const rows: DatevBooking[] = [];
  const skipped: number[] = [];
  for (const e of entries) {
    const r = datevRowsForEntry({ ...e, seq: num(e.seq), lines: e.lines.map((l) => ({ debit: num(l.debit), credit: num(l.credit), number: l.number })) });
    // DATEV takes numeric accounts only; an entry on an account without one is reported, not exported
    if (r && r.every((x) => DATEV_ACCOUNT.test(x.account) && DATEV_ACCOUNT.test(x.contraAccount))) rows.push(...r);
    else skipped.push(num(e.seq));
  }
  return { rows, skipped };
}
