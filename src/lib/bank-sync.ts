import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import * as eb from "@/lib/adapters/enablebanking";
import { openCharges } from "@/server/charge-ledger";
import { asActor, bookingsLockedUntil, inClosedPeriod, lockDay, periodLockMessage, type Actor } from "@/server/ledger";

// Bank-Sync ohne Auth-Bezug: genutzt von „Konten synchronisieren“ (manuell) und
// vom täglichen Hintergrund-Job (#54).
//
// nexrees: period close (Festschreibung). Transactions dated in the closed period are not imported
// (the closed months were reconciled when they were closed) but counted and reported; the fetch
// window starts after the closed period, and lastSyncAt always moves on, so one such transaction
// never blocks the account. Writes are journaled as source "bank-sync".

export type BankSyncResult = { imported: number; matched: number; skippedLocked: number; lockedUntil: string | null; failed: string[] };

const BANK_SYNC: Actor = { id: "", name: "Bank-Sync", source: "bank-sync" };

export async function bankConnector(tenantId: string): Promise<eb.Connector | null> {
  const c = await prisma.bankConnector.findUnique({ where: { tenantId } });
  if (!c) return null;
  return { applicationId: c.applicationId, privateKeyPem: decryptSecret(c.privateKeyEnc), baseUrl: c.baseUrl ?? undefined };
}

/** Transaktionen einer Verknüpfung abrufen, als Zahlungen buchen, offene Posten zuordnen. */
export async function syncLink(tenantId: string, linkId: string, conn: eb.Connector) {
  const link = await prisma.bankLink.findFirst({ where: { id: linkId, tenantId } });
  if (!link) throw new Error("Verknüpfung nicht gefunden");
  // 14 Tage Überlappung: Banken buchen teils rückdatiert (Buchungsdatum vor dem letzten Sync, #73).
  let from = link.lastSyncAt ? new Date(link.lastSyncAt.getTime() - 14 * 86_400_000) : new Date(Date.now() - 90 * 86_400_000);
  const lock = await bookingsLockedUntil(tenantId);
  if (lock && from.getTime() <= lock.getTime()) from = new Date(lock.getTime() + 86_400_000); // nexrees
  const raw = await eb.getTransactions(conn, link.accountUid, from.toISOString().slice(0, 10));

  // Offene Sollstellungen für Auto-Zuordnung (wie camt.053-Import).
  // nexrees: open charges only (oldest first), computed in Postgres
  const openMap = (await openCharges(tenantId)).map((c) => ({ id: c.id, open: c.open }));

  let imported = 0;
  let matched = 0;
  let skippedLocked = 0;
  for (const t of raw) {
    const m = eb.mapTransaction(t);
    if (!m.externalId || !m.date || m.amount <= 0) continue;
    // Dedup: bereits importierte externe Transaktion überspringen (Gegenseite ggf. nachtragen, #60).
    // Vor #73 importierte Zahlungen tragen nur die Bank-Referenz → zusätzlich über Datum+Betrag abgleichen.
    const known = await prisma.payment.findFirst({
      where: {
        tenantId,
        accountId: link.accountId,
        OR: [
          { externalId: m.externalId },
          ...(m.legacyId ? [{ externalId: m.legacyId, date: new Date(m.date), amount: m.amount }] : []),
        ],
      },
      select: { id: true, counterparty: true, date: true },
    });
    if (known) {
      // nexrees: a closed booking stays as it is
      if (!known.counterparty && m.counterparty && !inClosedPeriod(known.date, lock)) {
        await asActor(BANK_SYNC, (tx) =>
          tx.payment.update({ where: { id: known.id }, data: { counterparty: m.counterparty, counterpartyIban: m.counterpartyIban } }),
        );
      }
      continue;
    }
    if (inClosedPeriod(m.date, lock)) {
      skippedLocked++;
      continue;
    }
    let chargeId: string | null = null;
    if (m.direction === "EINGANG") {
      const hit = openMap.find((o) => o.open > 0 && Math.abs(o.open - m.amount) < 0.005);
      if (hit) {
        chargeId = hit.id;
        hit.open = 0;
        matched++;
      }
    }
    try {
      await prisma.payment.create({
        data: {
          tenantId, accountId: link.accountId, chargeId, date: new Date(m.date), amount: m.amount,
          direction: m.direction, reference: m.reference, externalId: m.externalId,
          counterparty: m.counterparty, counterpartyIban: m.counterpartyIban,
        },
      });
    } catch (e) {
      // the period was closed while this sync ran: count it like the others, keep going
      if (!periodLockMessage(e)) throw e;
      if (chargeId) matched--;
      skippedLocked++;
      continue;
    }
    imported++;
  }
  await prisma.bankLink.update({ where: { id: link.id }, data: { lastSyncAt: new Date() } });
  // Kontostand laut Bank (#57); manche Banken liefern keine Salden, dann bleibt der alte Wert.
  try {
    const bal = eb.pickBalance(await eb.getBalances(conn, link.accountUid));
    if (bal) {
      await prisma.account.update({
        where: { id: link.accountId },
        data: { balance: bal.amount, balanceAt: bal.date ? new Date(bal.date) : new Date() },
      });
    }
  } catch (e) {
    console.warn(`[bank] Kontostand ${link.id}: ${e instanceof Error ? e.message : e}`);
  }
  return { imported, matched, skippedLocked, lockedUntil: lockDay(lock) };
}

/** Alle verbundenen Konten eines Mandanten synchronisieren; Fehler je Konto sammeln. */
export async function syncTenantBank(tenantId: string): Promise<BankSyncResult | { error: string }> {
  let conn: eb.Connector | null;
  try {
    conn = await bankConnector(tenantId);
  } catch {
    return { error: "Bank-Connector-Schlüssel ungültig, bitte in den Einstellungen neu hinterlegen" };
  }
  if (!conn) return { error: "Kein Bank-Connector konfiguriert" };
  const links = await prisma.bankLink.findMany({ where: { tenantId }, include: { account: { select: { name: true } } } });
  const res: BankSyncResult = { imported: 0, matched: 0, skippedLocked: 0, lockedUntil: null, failed: [] };
  for (const l of links) {
    if (l.consentValidUntil && l.consentValidUntil < new Date()) {
      res.failed.push(`${l.account.name}: Freigabe abgelaufen`);
      continue;
    }
    try {
      const r = await syncLink(tenantId, l.id, conn);
      res.imported += r.imported;
      res.matched += r.matched;
      res.skippedLocked += r.skippedLocked;
      res.lockedUntil = r.lockedUntil;
    } catch (e) {
      res.failed.push(`${l.account.name}: ${e instanceof Error ? e.message : "Abruf fehlgeschlagen"}`);
    }
  }
  return res;
}
