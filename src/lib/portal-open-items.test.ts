import { describe, expect, it } from "vitest";
import { berlinDay, splitOpenItems } from "./portal-open-items";

const item = (id: string, due: string, open: number) => ({ id, dueDate: new Date(`${due}T00:00:00Z`), open });

describe("splitOpenItems", () => {
  const now = new Date("2026-11-09T10:00:00Z");

  it("puts past and today's due dates under due, later ones under upcoming", () => {
    const r = splitOpenItems([item("dec", "2026-12-03", 990), item("jul", "2026-07-03", 990), item("today", "2026-11-09", 50)], now);
    expect(r.due.map((i) => [i.id, i.overdue])).toEqual([
      ["jul", true],
      ["today", false],
    ]);
    expect(r.upcoming.map((i) => i.id)).toEqual(["dec"]);
  });

  it("totals the open amounts per group and overall, in cents", () => {
    const r = splitOpenItems([item("a", "2026-10-03", 0.1), item("b", "2026-10-15", 0.2), item("c", "2027-01-03", 990)], now);
    expect(r.dueTotal).toBe(0.3);
    expect(r.upcomingTotal).toBe(990);
    expect(r.total).toBe(990.3);
  });

  it("uses the calendar day in Germany (late evening UTC is already tomorrow)", () => {
    const lateEvening = new Date("2026-11-09T23:30:00Z"); // 10 Nov, 00:30 in Berlin
    expect(berlinDay(lateEvening)).toBe("2026-11-10");
    const r = splitOpenItems([item("x", "2026-11-10", 10)], lateEvening);
    expect(r.due.map((i) => [i.id, i.overdue])).toEqual([["x", false]]);
  });

  it("is empty for no items", () => {
    expect(splitOpenItems([], now)).toEqual({ due: [], upcoming: [], dueTotal: 0, upcomingTotal: 0, total: 0 });
  });
});
