// Copyright (c) 2026 NexRees.
import { describe, it, expect } from "vitest";
import { accountProblems, datevRowsForEntry, ledgerErrorFrom, manualEntryProblems, postManualEntry, reverseManualEntry, LedgerError, type LedgerDb } from "./core";

const entry = { date: "2026-11-10", text: "Hausmeister November", debitAccountId: "a", creditAccountId: "b", amount: 120.5 };

describe("manualEntryProblems", () => {
  it("accepts a complete entry", () => {
    expect(manualEntryProblems(entry)).toEqual({});
  });
  it("names the field for each problem", () => {
    expect(Object.keys(manualEntryProblems({ ...entry, date: "10.11.2026" }))).toEqual(["date"]);
    expect(Object.keys(manualEntryProblems({ ...entry, date: "2026-13-40" }))).toEqual(["date"]);
    expect(Object.keys(manualEntryProblems({ ...entry, text: "  " }))).toEqual(["text"]);
    expect(Object.keys(manualEntryProblems({ ...entry, creditAccountId: "a" }))).toEqual(["creditAccountId"]);
    expect(Object.keys(manualEntryProblems({ ...entry, amount: 0 }))).toEqual(["amount"]);
    expect(Object.keys(manualEntryProblems({ ...entry, amount: -5 }))).toEqual(["amount"]);
    expect(Object.keys(manualEntryProblems({ ...entry, amount: Number.NaN }))).toEqual(["amount"]);
    expect(Object.keys(manualEntryProblems({ ...entry, amount: 1.234 }))).toEqual(["amount"]);
  });
  it("takes amounts that are exact in cents but not in binary", () => {
    expect(manualEntryProblems({ ...entry, amount: 0.1 + 0.2 })).toEqual({});
    expect(manualEntryProblems({ ...entry, amount: 1234.56 })).toEqual({});
  });
});

describe("accountProblems", () => {
  it("checks number, name, type and DATEV number", () => {
    expect(accountProblems({ number: "4100", name: "Hausmeister", type: "EXPENSE" }, true)).toEqual({});
    expect(Object.keys(accountProblems({ number: "", name: "", type: undefined }, true))).toEqual(["number", "name", "type"]);
    expect(accountProblems({ number: "4100", name: "Hausmeister" }, false)).toEqual({});
    expect(Object.keys(accountProblems({ number: "4100", name: "x", datevNumber: "41" }, false))).toEqual(["datevNumber"]);
    expect(Object.keys(accountProblems({ number: "41 00", name: "x" }, false))).toEqual(["number"]);
  });
});

describe("ledgerErrorFrom", () => {
  it("turns database refusals into readable errors with a status", () => {
    const e = ledgerErrorFrom(new Error("Raw query failed. Code: `P0001`. Message: `ERROR: NEXREES_LEDGER_UNBALANCED: Soll (10.00) und Haben (9.00) müssen gleich sein`"));
    expect(e).toBeInstanceOf(LedgerError);
    expect(e?.message).toBe("Soll (10.00) und Haben (9.00) müssen gleich sein");
    expect(e?.code).toBe("ledger_unbalanced");
    expect(e?.status).toBe(400);
  });
  it("maps the closed period to 409 period_locked", () => {
    const e = ledgerErrorFrom(new Error("NEXREES_PERIOD_LOCKED: JournalEntry vom 15.09.2026 liegt im festgeschriebenen Zeitraum (bis 30.09.2026)"));
    expect(e?.status).toBe(409);
    expect(e?.code).toBe("period_locked");
    expect(e?.message).toContain("15.09.2026");
    expect(e?.message).not.toContain("JournalEntry");
  });
  it("maps a taken account number and ignores unrelated errors", () => {
    expect(ledgerErrorFrom(new Error('duplicate key value violates unique constraint "LedgerAccount_tenantId_number_key"'))?.status).toBe(409);
    expect(ledgerErrorFrom(new Error("connection refused"))).toBeNull();
  });
});

describe("posting through the port", () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = (rows: Record<string, unknown>[][]): LedgerDb => ({
    query: async (sql, ...params) => {
      calls.push({ sql, params });
      return (rows.shift() ?? []) as never;
    },
  });

  it("sends a balanced two-line entry to nexrees_ledger_post", async () => {
    calls.length = 0;
    const id = await postManualEntry(db([[{ id: "e1" }]]), "t1", { ...entry, propertyId: "" });
    expect(id).toBe("e1");
    expect(calls[0].sql).toContain("nexrees_ledger_post");
    expect(calls[0].params.slice(0, 4)).toEqual(["t1", "2026-11-10", "Hausmeister November", null]);
    expect(JSON.parse(String(calls[0].params[4]))).toEqual([{ id: "a", debit: 120.5 }, { id: "b", credit: 120.5 }]);
  });
  it("does not reach the database with an invalid entry", async () => {
    calls.length = 0;
    await expect(postManualEntry(db([]), "t1", { ...entry, amount: 0 })).rejects.toBeInstanceOf(LedgerError);
    expect(calls).toHaveLength(0);
  });
  it("refuses to reverse an entry that stands for a document", async () => {
    await expect(reverseManualEntry(db([[{ sourceTable: "Charge" }]]), "t1", "e1")).rejects.toMatchObject({ code: "ledger_has_document", status: 409 });
    await expect(reverseManualEntry(db([[]]), "t1", "nope")).rejects.toMatchObject({ status: 404 });
    await expect(reverseManualEntry(db([[{ sourceTable: null }], [{ id: "s1" }]]), "t1", "e1")).resolves.toBe("s1");
  });
});

describe("datevRowsForEntry", () => {
  const base = { seq: 7, date: "2026-03-01", text: "Sollstellung Miete 03/2026" };
  it("exports debit an credit as one row", () => {
    expect(datevRowsForEntry({ ...base, lines: [{ debit: 800, credit: 0, number: "1400" }, { debit: 0, credit: 800, number: "8100" }] })).toEqual([
      { amount: 800, debitCredit: "S", account: "1400", contraAccount: "8100", date: "2026-03-01", text: "Sollstellung Miete 03/2026", invoiceField: "7" },
    ]);
  });
  it("splits an entry with several lines on one side", () => {
    const rows = datevRowsForEntry({ ...base, lines: [{ debit: 100, credit: 0, number: "1200" }, { debit: 0, credit: 60, number: "8100" }, { debit: 0, credit: 40, number: "8200" }] });
    expect(rows?.map((r) => [r.account, r.contraAccount, r.amount])).toEqual([["1200", "8100", 60], ["1200", "8200", 40]]);
  });
  it("reports an entry with several lines on both sides", () => {
    expect(datevRowsForEntry({ ...base, lines: [{ debit: 50, credit: 0, number: "1" }, { debit: 50, credit: 0, number: "2" }, { debit: 0, credit: 30, number: "3" }, { debit: 0, credit: 70, number: "4" }] })).toBeNull();
  });
});
