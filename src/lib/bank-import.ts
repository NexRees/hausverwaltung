import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { BankEntry } from "@/lib/adapters/bankImport";
import { openCharges } from "@/server/charge-ledger";
import { asActor, bookingsLockedUntil, inClosedPeriod, lockDay, type Actor } from "@/server/ledger";

// nexrees: camt.053 import shared by the web form and the API/MCP operation.
// - All or nothing: one transaction, so a failure never leaves half a statement behind.
// - Dedup: each entry gets a stable externalId (the bank's reference, else a hash of its content
//   and its position among identical entries in the file), so importing a statement twice or
//   overlapping statements does not create payments twice.
// - Entries dated in the closed period (Festschreibung) are not imported but counted, so the rest
//   of the statement still goes in; the closed month was reconciled when it was closed.

export type CamtImportResult = {
  imported: number;
  matched: number;
  duplicates: number;
  skippedLocked: number;
  lockedUntil: string | null; // YYYY-MM-DD
};

export function camtExternalIds(accountId: string | null, entries: BankEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    if (e.ref) return `camt:${accountId ?? "-"}:${e.ref}`.slice(0, 190);
    const base = [accountId ?? "-", e.date, e.amount.toFixed(2), e.direction, e.reference ?? "", e.counterpartyIban ?? ""].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `camt:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`;
  });
}

export async function importCamtEntries(
  tenantId: string,
  accountId: string | null,
  entries: BankEntry[],
  actor: Actor,
): Promise<CamtImportResult> {
  const lock = await bookingsLockedUntil(tenantId);
  const ids = camtExternalIds(accountId, entries);
  const known = new Set(
    (await prisma.payment.findMany({ where: { tenantId, externalId: { in: ids } }, select: { externalId: true } })).map((p) => p.externalId),
  );

  let duplicates = 0;
  let skippedLocked = 0;
  const fresh: { e: BankEntry; externalId: string }[] = [];
  entries.forEach((e, i) => {
    if (known.has(ids[i])) duplicates++;
    else if (inClosedPeriod(e.date, lock)) skippedLocked++;
    else fresh.push({ e, externalId: ids[i] });
  });

  // offene Beträge je Sollstellung für Auto-Matching (oldest first, computed in Postgres)
  const openMap = (await openCharges(tenantId)).map((c) => ({ id: c.id, open: c.open }));
  let matched = 0;
  const data = fresh.map(({ e, externalId }) => {
    let chargeId: string | null = null;
    if (e.direction === "EINGANG") {
      const hit = openMap.find((o) => o.open > 0 && Math.abs(o.open - e.amount) < 0.005);
      if (hit) {
        chargeId = hit.id;
        hit.open = 0; // verbraucht
        matched++;
      }
    }
    return {
      tenantId, accountId, chargeId, externalId,
      date: new Date(e.date), amount: e.amount, direction: e.direction, reference: e.reference,
      counterparty: e.counterparty, counterpartyIban: e.counterpartyIban,
    };
  });

  const imported = data.length
    ? (await asActor(actor, (tx) => tx.payment.createMany({ data, skipDuplicates: true }))).count
    : 0;
  return { imported, matched, duplicates, skippedLocked, lockedUntil: lockDay(lock) };
}

const de = (ymd: string) => ymd.split("-").reverse().join(".");

export function camtSummary(r: CamtImportResult): string {
  let s = `${r.imported} Buchungen importiert, ${r.matched} zugeordnet`;
  if (r.duplicates) s += `, ${r.duplicates} bereits vorhanden`;
  if (r.skippedLocked && r.lockedUntil) s += `, ${r.skippedLocked} im festgeschriebenen Zeitraum (bis ${de(r.lockedUntil)}) nicht übernommen`;
  return s;
}
