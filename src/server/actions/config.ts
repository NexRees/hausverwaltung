"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isNotifyKind } from "@/lib/notify-kinds";
import { requireRole } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { pingAi, aiResidencyProblem } from "@/lib/ai";
import { encryptSecret, openSecret } from "@/lib/crypto";
import { creditorIdValid, ibanValid, bicValid, normalizeIban } from "@/lib/sepa-validate";
import { verifyMailer } from "@/lib/adapters/mailer";
import { verifyImap } from "@/lib/adapters/imap";
import { clampSyncInterval, clampAttachMaxMb } from "@/lib/inbound";
import type { ActionState } from "@/lib/schemas";
import { maxLockMonth, monthEnd } from "@/server/ledger";

const str = (v: FormDataEntryValue | null) => {
  const x = String(v ?? "").trim();
  return x || undefined;
};

// --- Mandant ---

export async function updateTenantName(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const name = str(fd.get("name"));
  if (!name) return { error: "Name erforderlich" };
  const address = str(fd.get("address")) ?? null;
  const phone = str(fd.get("phone")) ?? null;
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { name, address, phone } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, `Name: ${name}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Postausgang (#79) ---

export async function updateOutboxConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  let outboxDelayMin: number | null = null;
  if (fd.get("manual") !== "on") {
    outboxDelayMin = Number(str(fd.get("outboxDelayMin")) ?? "0");
    if (!Number.isInteger(outboxDelayMin) || outboxDelayMin < 0 || outboxDelayMin > 1440) {
      return { error: "Verzögerung: 0 bis 1440 Minuten" };
    }
  }
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { outboxDelayMin } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, `Postausgang: ${outboxDelayMin ?? "manuell"}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- E-Mail-Benachrichtigungen (#77) ---

export async function updateNotifyConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const notifyEmail = fd.getAll("kinds").map(String).filter(isNotifyKind);
  // Cursor neu setzen: nach dem (Wieder-)Einschalten nichts rückwirkend nachmelden
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { notifyEmail, notifyCursorAt: new Date() } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, `Benachrichtigungen: ${notifyEmail.join(", ") || "aus"}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Abrechnungs-Standards ---

export async function updateStatementDefaults(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const raw = str(fd.get("heatingConsumptionPct"));
  // nexrees: §§ 7, 8 HeizkostenV: 50–100 % by consumption (above 70 % only by agreement, § 10)
  const pct = raw ? Math.min(100, Math.max(50, parseInt(raw, 10) || 70)) : null;
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { heatingConsumptionPct: pct } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, "Abrechnungs-Standards");
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Datumsformat ---

export async function updateDateFormat(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const raw = str(fd.get("dateFormat"));
  const allowed = ["de-DE", "en-GB", "en-US", "iso"];
  const dateFormat = raw && allowed.includes(raw) ? raw : null; // leer/unbekannt = UI-Sprache
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { dateFormat } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, `Datumsformat: ${dateFormat ?? "Auto"}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- KI-Konfiguration ---

export async function updateAiConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const apiKey = str(fd.get("aiApiKey")); // leer = unverändert lassen
  const model = str(fd.get("aiModel"));
  const provider = str(fd.get("aiProvider"));
  const baseUrl = str(fd.get("aiBaseUrl"));
  // nexrees: refuse AI endpoints outside the data residency region before anything is stored
  const problem = aiResidencyProblem({ provider, baseUrl, model });
  if (problem) return { error: problem };
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      aiProvider: provider ?? null,
      aiBaseUrl: baseUrl ?? null,
      aiModel: model ?? null,
      ...(apiKey ? { aiApiKey: encryptSecret(apiKey) } : {}), // nexrees: encrypted at rest
    },
  });
  await audit(user, "UPDATE", "Tenant", user.tenantId, "KI-Konfiguration");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function testAiConfig(_p: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const t = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { aiProvider: true, aiBaseUrl: true, aiApiKey: true, aiModel: true },
  });
  try {
    await pingAi({ provider: t?.aiProvider, baseUrl: t?.aiBaseUrl, apiKey: t?.aiApiKey, model: t?.aiModel });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "KI-Test fehlgeschlagen" };
  }
}

// --- SMTP-Konfiguration ---

export async function updateSmtpConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const password = str(fd.get("smtpPassword")); // leer = unverändert lassen
  const portRaw = str(fd.get("smtpPort"));
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      smtpHost: str(fd.get("smtpHost")) ?? null,
      smtpPort: portRaw ? Number(portRaw) : null,
      smtpUser: str(fd.get("smtpUser")) ?? null,
      smtpFrom: str(fd.get("smtpFrom")) ?? null,
      smtpSecure: String(fd.get("smtpSecure")) === "true",
      ...(password ? { smtpPassword: encryptSecret(password) } : {}), // nexrees: encrypted at rest
    },
  });
  await audit(user, "UPDATE", "Tenant", user.tenantId, "SMTP-Konfiguration");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function testSmtpConfig(_p: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const t = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: {
      smtpHost: true, smtpPort: true, smtpUser: true,
      smtpPassword: true, smtpFrom: true, smtpSecure: true,
    },
  });
  try {
    await verifyMailer({
      host: t?.smtpHost, port: t?.smtpPort, user: t?.smtpUser,
      password: openSecret(t?.smtpPassword), from: t?.smtpFrom, secure: t?.smtpSecure,
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "SMTP-Test fehlgeschlagen" };
  }
}

// --- IMAP-Konfiguration (E-Mail-Empfang, #39) ---

export async function updateImapConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const password = str(fd.get("imapPassword")); // leer = unverändert lassen
  const portRaw = str(fd.get("imapPort"));
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      imapHost: str(fd.get("imapHost")) ?? null,
      imapPort: portRaw ? Number(portRaw) : null,
      imapUser: str(fd.get("imapUser")) ?? null,
      imapMailbox: str(fd.get("imapMailbox")) ?? null,
      imapSecure: String(fd.get("imapSecure")) === "true",
      imapAutoSync: fd.get("imapAutoSync") === "on",
      imapSyncIntervalMin: clampSyncInterval(Number(fd.get("imapSyncIntervalMin"))),
      imapAttachments: fd.get("imapAttachments") === "on",
      imapAttachMaxMb: clampAttachMaxMb(Number(fd.get("imapAttachMaxMb"))),
      ...(password ? { imapPassword: encryptSecret(password) } : {}), // nexrees: encrypted at rest
    },
  });
  await audit(user, "UPDATE", "Tenant", user.tenantId, "IMAP-Konfiguration");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function testImapConfig(_p: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const t = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { imapHost: true, imapPort: true, imapUser: true, imapPassword: true, imapSecure: true, imapMailbox: true },
  });
  try {
    await verifyImap({
      host: t?.imapHost, port: t?.imapPort, user: t?.imapUser,
      password: openSecret(t?.imapPassword), secure: t?.imapSecure, mailbox: t?.imapMailbox,
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "IMAP-Test fehlgeschlagen" };
  }
}

// --- nexrees: Buchhaltung (Festschreibung, SEPA-Gläubigerdaten) ---

export async function updateBookkeepingConfig(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  const creditorId = str(fd.get("sepaCreditorId"))?.replace(/\s+/g, "").toUpperCase();
  const iban = str(fd.get("sepaCreditorIban"));
  const bic = str(fd.get("sepaCreditorBic"))?.replace(/\s+/g, "").toUpperCase();
  if (creditorId && !creditorIdValid(creditorId)) return { error: "Gläubiger-ID ist ungültig (Prüfziffer)." };
  if (iban && !ibanValid(iban)) return { error: "Gläubiger-IBAN ist ungültig (Prüfziffer)." };
  if (bic && !bicValid(bic)) return { error: "BIC ist ungültig." };
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { sepaCreditorId: creditorId ?? null, sepaCreditorIban: iban ? normalizeIban(iban) : null, sepaCreditorBic: bic ?? null },
  });
  await audit(user, "UPDATE", "Tenant", user.tenantId, "SEPA-Gläubigerdaten");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Festschreibung: closes all bookings up to and including the end of the given month. Cannot be undone. */
export async function lockBookings(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);
  // nexrees: whole months only (Charges are dated by month; a mid-month lock would freeze the rest
  // of that month, including NK back payments booked in the current month)
  const raw = str(fd.get("lockMonth"));
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return { error: "Bitte einen Monat wählen." };
  if (raw > maxLockMonth()) return { error: "Festschreiben ist nur für abgeschlossene Monate möglich." };
  const until = monthEnd(raw);
  const t = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { bookingsLockedUntil: true } });
  if (t?.bookingsLockedUntil && until <= t.bookingsLockedUntil) {
    return { error: "Dieser Zeitraum ist bereits festgeschrieben. Ein festgeschriebener Zeitraum kann nicht wieder geöffnet werden." };
  }
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { bookingsLockedUntil: until } });
  await audit(user, "UPDATE", "Tenant", user.tenantId, `Buchungen festgeschrieben bis ${until.toISOString().slice(0, 10)}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
