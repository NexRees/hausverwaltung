import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// nexrees: app side of the bookkeeping guards in migration
// 20261109210000_nexrees_bookkeeping_integrity. The database refuses writes into a closed period
// and journals every change of financial rows; this module tells it who is acting and turns its
// refusals into readable German messages.

export type Actor = { id: string; name?: string | null; source: string };

const ENTITY_DE: Record<string, string> = {
  Charge: "Sollstellung",
  Payment: "Zahlung",
  CostEntry: "Kostenposition",
  ReserveTransaction: "Rücklagenbuchung",
};

/** Readable message when `e` is the period-lock refusal from the database, else null. */
export function periodLockMessage(e: unknown): string | null {
  if (e instanceof PeriodLockedError) return e.message; // already readable (from asActor)
  const text = e instanceof Error ? e.message : String(e ?? "");
  const m = /NEXREES_PERIOD_LOCKED: (\w+) vom ([\d.]+) liegt im festgeschriebenen Zeitraum \(bis ([\d.]+)\)/.exec(text);
  if (!m) return null;
  const what = ENTITY_DE[m[1]] ?? m[1];
  return `${what} vom ${m[2]} liegt im festgeschriebenen Zeitraum (bis ${m[3]}) und kann nicht mehr geändert werden. Korrekturen bitte als neue Buchung im offenen Zeitraum erfassen.`;
}

/** HTTP-shaped so API error mappers answer 409 { error, code: "period_locked" }. */
export class PeriodLockedError extends Error {
  readonly status = 409;
  readonly code = "period_locked";
}

/**
 * Runs `fn` in a transaction that names the acting user for the database journal. A period-lock
 * refusal is rethrown as PeriodLockedError with a readable message.
 */
export async function asActor<T>(actor: Actor, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('nexrees.user_id', ${actor.id}, true), set_config('nexrees.user_name', ${actor.name ?? ""}, true), set_config('nexrees.source', ${actor.source}, true)`;
      return fn(tx);
    }, { timeout: 60_000, maxWait: 10_000 }); // cascading deletes of a property can take a while
  } catch (e) {
    const msg = periodLockMessage(e);
    if (msg) throw new PeriodLockedError(msg);
    throw e;
  }
}

/** Deletes a whole company: the journal and the period lock step aside (offboarding, retention). */
export async function asPurge<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('nexrees.purge', 'on', true)`;
      return fn(tx);
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}

/** Lock day as stored (end of that day counts as closed); null = nothing closed. */
export async function bookingsLockedUntil(tenantId: string): Promise<Date | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { bookingsLockedUntil: true } });
  return t?.bookingsLockedUntil ?? null;
}

/** Actor for a signed-in user of the web app. */
export function uiActor(user: { id: string; name?: string | null; email?: string | null }): Actor {
  return { id: user.id, name: user.name ?? user.email ?? null, source: "ui" };
}

/**
 * For server actions: run a booking write as `user`; a period-lock refusal becomes `{ error }`
 * (Next.js hides thrown messages in production), anything else is rethrown.
 */
export async function bookAs(
  user: { id: string; name?: string | null; email?: string | null },
  fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<{ error: string } | undefined> {
  try {
    await asActor(uiActor(user), fn);
    return undefined;
  } catch (e) {
    if (e instanceof PeriodLockedError) return { error: e.message };
    throw e;
  }
}

/** YYYY-MM-DD of a stored lock day, or null. */
export function lockDay(lock: Date | null | undefined): string | null {
  return lock ? lock.toISOString().slice(0, 10) : null;
}

/** True when a booking dated `day` (YYYY-MM-DD or Date) falls into the closed period. */
export function inClosedPeriod(day: string | Date, lock: Date | null | undefined): boolean {
  const l = lockDay(lock);
  if (!l) return false;
  const d = typeof day === "string" ? day.slice(0, 10) : day.toISOString().slice(0, 10);
  return d <= l;
}

const de = (ymd: string) => ymd.split("-").reverse().join(".");

/**
 * Readable refusal when a booking dated `day` would fall into the closed period, else null.
 * Lets writers check before they start instead of failing halfway (the trigger stays the backstop).
 */
export async function closedPeriodProblem(tenantId: string, day: Date, what: string): Promise<string | null> {
  const lock = await bookingsLockedUntil(tenantId);
  if (!inClosedPeriod(day, lock)) return null;
  return `${what} vom ${de(day.toISOString().slice(0, 10))} liegt im festgeschriebenen Zeitraum (bis ${de(lockDay(lock)!)}) und kann nicht mehr gebucht werden.`;
}

/**
 * The period is closed by whole months (Charges are dated by month, so a lock inside a month would
 * freeze the rest of it). Latest month that can be closed: the previous one (YYYY-MM, UTC).
 */
export function maxLockMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 7);
}

/** Last day of a YYYY-MM month (UTC midnight), the stored lock value. */
export function monthEnd(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}
