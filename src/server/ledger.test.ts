import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("periodLockMessage", () => {
  it("turns the database refusal into a readable message", async () => {
    const { periodLockMessage } = await import("./ledger");
    const raw = new Error(
      'Invalid `prisma.charge.deleteMany()` invocation:\nError occurred during query execution: ConnectorError(... "NEXREES_PERIOD_LOCKED: Charge vom 01.01.2026 liegt im festgeschriebenen Zeitraum (bis 31.03.2026)" ...)',
    );
    expect(periodLockMessage(raw)).toBe(
      "Sollstellung vom 01.01.2026 liegt im festgeschriebenen Zeitraum (bis 31.03.2026) und kann nicht mehr geändert werden. Korrekturen bitte als neue Buchung im offenen Zeitraum erfassen.",
    );
    expect(periodLockMessage(new Error("other"))).toBeNull();
  });
});
