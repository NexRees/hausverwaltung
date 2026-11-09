// nexrees: one-leader election for the in-process background jobs (src/instrumentation.ts).
// Every app instance starts the schedulers; before each run they ask for the "scheduler" lease.
// The lease is a single row: whoever holds it (and renews it within the TTL) runs the jobs, the
// others skip. If the leader dies, another instance takes over once the lease expires. No
// connection is held between runs, unlike a Postgres advisory lock.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const SCHEDULER_LEASE = "scheduler";
export const LEASE_TTL_MS = 3 * 60_000; // longer than the shortest tick (1 min) so the leader keeps it

const g = globalThis as unknown as { __havewaInstanceId?: string };
export const instanceId = (g.__havewaInstanceId ??= `${process.env.HOSTNAME ?? "app"}:${process.pid}:${randomUUID().slice(0, 8)}`);

/** True if this instance holds (or just took/renewed) the lease. Never throws: on DB errors it answers false. */
export async function acquireLease(name = SCHEDULER_LEASE, ttlMs = LEASE_TTL_MS, holder = instanceId): Promise<boolean> {
  try {
    // Take the lease if it is free, expired or already ours; one atomic statement. Times come from
    // the database clock only, so clock drift between instances does not matter.
    const rows = await prisma.$queryRaw<{ holder: string }[]>`
      INSERT INTO "JobLease" ("name", "holder", "expiresAt")
      VALUES (${name}, ${holder}, now() + ${ttlMs} * interval '1 millisecond')
      ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "JobLease"."holder" = EXCLUDED."holder" OR "JobLease"."expiresAt" < now()
      RETURNING "holder"`;
    return rows.length === 1 && rows[0].holder === holder;
  } catch (e) {
    console.warn("[jobs] lease check failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Gives the lease up (e.g. on shutdown) so another instance can take over at once. */
export async function releaseLease(name = SCHEDULER_LEASE, holder = instanceId): Promise<void> {
  await prisma.jobLease.deleteMany({ where: { name, holder } }).catch(() => undefined);
}
