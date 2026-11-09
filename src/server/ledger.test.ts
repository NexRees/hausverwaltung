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

describe("month-granular period close", () => {
  it("closes whole months up to the previous one", async () => {
    const { maxLockMonth, monthEnd, inClosedPeriod } = await import("./ledger");
    expect(maxLockMonth(new Date("2026-11-09T12:00:00Z"))).toBe("2026-10");
    expect(maxLockMonth(new Date("2026-01-01T00:30:00Z"))).toBe("2025-12");
    expect(monthEnd("2026-02").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(monthEnd("2028-02").toISOString().slice(0, 10)).toBe("2028-02-29");
    const lock = monthEnd("2026-10");
    expect(inClosedPeriod("2026-10-31", lock)).toBe(true);
    expect(inClosedPeriod("2026-11-01", lock)).toBe(false);
    expect(inClosedPeriod(new Date("2026-10-01T00:00:00Z"), lock)).toBe(true);
    expect(inClosedPeriod("2020-01-01", null)).toBe(false);
  });
});
