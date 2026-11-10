import { describe, it, expect } from "vitest";
import { contrastRatio, readableForeground } from "./color";

describe("readableForeground", () => {
  it("dunkler Text auf hellem Hintergrund", () => {
    expect(readableForeground("#ffffff")).toBe("#111827");
    expect(readableForeground("#fde047")).toBe("#111827"); // gelb
    // nexrees: mid tones get dark text; white on amber is only 3.2:1
    expect(readableForeground("#d97706")).toBe("#111827"); // Bernstein
    expect(readableForeground("#22c55e")).toBe("#111827"); // Grün
  });
  it("weißer Text auf dunklem/sattem Hintergrund", () => {
    expect(readableForeground("#000000")).toBe("#ffffff");
    expect(readableForeground("#2563eb")).toBe("#ffffff"); // Blau
    expect(readableForeground("#4f46e5")).toBe("#ffffff"); // Indigo
  });
  it("Fallback bei ungültiger Eingabe", () => {
    expect(readableForeground(null)).toBe("#ffffff");
    expect(readableForeground("nope")).toBe("#ffffff");
    expect(readableForeground("#fff")).toBe("#ffffff");
  });
  it("nexrees: the chosen text colour always reaches at least 4.5:1 when one of the two can", () => {
    for (const bg of ["#2563eb", "#4f46e5", "#d97706", "#22c55e", "#0ea5e9", "#e11d48", "#334155", "#a855f7", "#14b8a6"]) {
      const fg = readableForeground(bg);
      const best = Math.max(contrastRatio(bg, "#111827")!, contrastRatio(bg, "#ffffff")!);
      expect(contrastRatio(bg, fg)).toBe(best);
    }
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
});
