import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// nexrees: app side of the bookkeeping guards in migration
// 20261109200000_nexrees_bookkeeping_integrity. The database refuses writes into a closed period
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
  const text = e instanceof Error ? e.message : String(e ?? "");
  const m = /NEXREES_PERIOD_LOCKED: (\w+) vom ([\d.]+) liegt im festgeschriebenen Zeitraum \(bis ([\d.]+)\)/.exec(text);
  if (!m) return null;
  const what = ENTITY_DE[m[1]] ?? m[1];
  return `${what} vom ${m[2]} liegt im festgeschriebenen Zeitraum (bis ${m[3]}) und kann nicht mehr geändert werden. Korrekturen bitte als neue Buchung im offenen Zeitraum erfassen.`;
}

export class PeriodLockedError extends Error {}

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

/** Latest day that can be closed: yesterday (YYYY-MM-DD, UTC). */
export function maxLockDate(now = new Date()): string {
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
}
