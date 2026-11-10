import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("camtExternalIds", () => {
  const e = (over: Record<string, unknown> = {}) =>
    ({ date: "2026-11-02", amount: 800, direction: "EINGANG", reference: "Miete 11/2026", counterpartyIban: "DE89370400440532013000", ...over }) as never;

  it("uses the bank reference when there is one", async () => {
    const { camtExternalIds } = await import("./bank-import");
    expect(camtExternalIds("acc1", [e({ ref: "2026110200123" })])).toEqual(["camt:acc1:2026110200123"]);
  });

  it("gives the same ids when a statement is imported again, and keeps identical entries apart", async () => {
    const { camtExternalIds } = await import("./bank-import");
    const file = [e(), e(), e({ amount: 650 })];
    const a = camtExternalIds("acc1", file);
    const b = camtExternalIds("acc1", file);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3); // two identical payments on one day stay two payments
    expect(camtExternalIds("acc2", file)[0]).not.toBe(a[0]); // per account
  });
});
