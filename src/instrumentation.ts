// Next.js-Hook: läuft einmal beim Serverstart. Startet Hintergrund-Jobs, die nur
// im Node-Runtime Sinn ergeben (nicht Edge, nicht beim Build).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // nexrees: encrypt credentials saved in plaintext before encryption at rest existed
  try {
    const { encryptLegacySecrets } = await import("./lib/secret-backfill");
    const n = await encryptLegacySecrets();
    if (n) console.log(`[secrets] encrypted legacy credentials of ${n} tenant(s)`);
  } catch (e) {
    console.error("[secrets] could not encrypt legacy credentials", e);
  }
  if (process.env.HAVEWA_DISABLE_SCHEDULER === "1") return;
  const { startInboundScheduler } = await import("./lib/inbound-scheduler");
  startInboundScheduler();
  const { startBankScheduler } = await import("./lib/bank-scheduler");
  startBankScheduler();
  const { startLetterScheduler } = await import("./lib/letter-scheduler");
  startLetterScheduler();
  const { startOutboxScheduler } = await import("./lib/outbox-scheduler");
  startOutboxScheduler();
  const { startNotifyScheduler } = await import("./lib/notify-scheduler");
  startNotifyScheduler();
}
