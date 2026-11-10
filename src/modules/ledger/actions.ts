"use server";
// Copyright (c) 2026 NexRees.
//
// Server actions of the ledger page (host glue: session, roles, revalidation).
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import type { ActionState } from "@/lib/schemas";
import { PeriodLockedError, uiActor } from "@/server/ledger";
import {
  ledgerErrorFrom,
  accountProblems,
  createAccount,
  manualEntryProblems,
  postManualEntry,
  reverseManualEntry,
  updateAccount,
  type AccountType,
} from "./core";
import { ledgerDb, propertyOfTenant, withLedger } from "./havewa";

// Bookkeeping is the accountant's and the manager's job (ADMIN passes every role check).
const LEDGER_ROLES = ["VERWALTER", "BUCHHALTUNG"] as const;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function refused(e: unknown): ActionState {
  const le = ledgerErrorFrom(e);
  if (le) return { error: le.message };
  if (e instanceof PeriodLockedError) return { error: e.message };
  throw e;
}

function invalidFields(problems: Record<string, string>): ActionState | null {
  const first = Object.values(problems)[0];
  return first ? { error: first, fieldErrors: problems } : null;
}

export async function postJournalEntry(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole([...LEDGER_ROLES]);
  const input = {
    date: str(fd, "date"),
    text: str(fd, "text"),
    debitAccountId: str(fd, "debitAccountId"),
    creditAccountId: str(fd, "creditAccountId"),
    amount: Number(str(fd, "amount").replace(",", ".")),
    propertyId: str(fd, "propertyId") || null,
  };
  const bad = invalidFields(manualEntryProblems(input));
  if (bad) return bad;
  if (input.propertyId && !(await propertyOfTenant(user.tenantId, input.propertyId))) {
    return { error: "Objekt nicht gefunden.", fieldErrors: { propertyId: "Objekt nicht gefunden." } };
  }
  try {
    await withLedger(uiActor(user), (db) => postManualEntry(db, user.tenantId, input));
  } catch (e) {
    return refused(e);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function stornoJournalEntry(fd: FormData): Promise<void | { error: string }> {
  const user = await requireRole([...LEDGER_ROLES]);
  try {
    await withLedger(uiActor(user), (db) => reverseManualEntry(db, user.tenantId, str(fd, "id")));
  } catch (e) {
    const r = refused(e);
    return { error: r.error ?? "Storno nicht möglich." };
  }
  revalidatePath("/", "layout");
}

export async function saveLedgerAccount(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole([...LEDGER_ROLES]);
  const id = str(fd, "id");
  const input = {
    number: str(fd, "number"),
    name: str(fd, "name"),
    type: (str(fd, "type") || undefined) as AccountType | undefined,
    datevNumber: str(fd, "datevNumber") || null,
  };
  const bad = invalidFields(accountProblems(input, !id));
  if (bad) return bad;
  try {
    if (id) await updateAccount(ledgerDb(), user.tenantId, id, input);
    else await createAccount(ledgerDb(), user.tenantId, input);
  } catch (e) {
    const r = refused(e);
    return r.error && /Kontonummer/.test(r.error) ? { ...r, fieldErrors: { number: r.error } } : r;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
