import { describe, expect, it } from "vitest";
import { chargeStatus } from "./charge-ledger";

const now = new Date("2026-11-09T12:00:00Z");
const past = new Date("2026-11-03T00:00:00Z");
const future = new Date("2026-12-03T00:00:00Z");

describe("chargeStatus (same rule as the SQL in chargeLedgerPage/openCharges)", () => {
  it("paid when nothing (or less than 0.1 ct) is open", () => {
    expect(chargeStatus(100, 100, past, now)).toBe("PAID");
    expect(chargeStatus(100, 99.9995, past, now)).toBe("PAID");
    expect(chargeStatus(100, 120, past, now)).toBe("PAID");
  });
  it("overdue when open after the due date, also if partly paid", () => {
    expect(chargeStatus(100, 0, past, now)).toBe("OVERDUE");
    expect(chargeStatus(100, 50, past, now)).toBe("OVERDUE");
  });
  it("open or partial before the due date", () => {
    expect(chargeStatus(100, 0, future, now)).toBe("OPEN");
    expect(chargeStatus(100, 50, future, now)).toBe("PARTIAL");
  });
});
