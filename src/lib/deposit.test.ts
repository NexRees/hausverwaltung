import { describe, it, expect } from "vitest";
import { depositInterest } from "./deposit";

describe("depositInterest", () => {
  it("1 Jahr, 2% auf 2400 = 48", () => {
    expect(depositInterest(2400, 2, new Date("2025-01-01"), new Date("2026-01-01"))).toBe(48);
  });

  it("kein Zinssatz = 0", () => {
    expect(depositInterest(2400, null, new Date("2025-01-01"), new Date("2026-01-01"))).toBe(0);
  });

  it("kein Erhalt-Datum = 0", () => {
    expect(depositInterest(2400, 2, null, new Date("2026-01-01"))).toBe(0);
  });

  it("halbes Jahr ~ halber Zins", () => {
    const i = depositInterest(2400, 2, new Date("2025-01-01"), new Date("2025-07-02"));
    expect(i).toBeGreaterThan(23);
    expect(i).toBeLessThan(25);
  });
});

describe("nexrees: compounding and § 551 cap", () => {
  it("compounds yearly (interest increases the deposit)", async () => {
    // 1000 at 10 % for 2 years: 1000 * 1.1^2 - 1000 = 210 (simple interest would be 200)
    expect(depositInterest(1000, 10, new Date("2024-01-01"), new Date("2025-12-31"))).toBe(210);
  });

  it("caps residential deposits at three months' net cold rent", async () => {
    const { depositCapProblem } = await import("./deposit");
    expect(depositCapProblem(2400, 800, "WOHNUNG")).toBeNull();
    expect(depositCapProblem(2400.01, 800, "WOHNUNG")).toMatch(/§ 551/);
    expect(depositCapProblem(5000, 800, "GEWERBE")).toBeNull();
  });
});
