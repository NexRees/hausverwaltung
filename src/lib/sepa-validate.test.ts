import { describe, it, expect } from "vitest";
import { ibanValid, creditorIdValid, bicValid, normalizeIban } from "./sepa-validate";

describe("SEPA identifiers", () => {
  it("checks IBANs", () => {
    expect(ibanValid("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(ibanValid("DE89370400440532013001")).toBe(false);
    expect(ibanValid("DE00000000000000000000")).toBe(false); // upstream placeholder
    expect(normalizeIban("de89 3704 0044 0532 0130 00")).toBe("DE89370400440532013000");
  });
  it("checks creditor identifiers", () => {
    expect(creditorIdValid("DE98ZZZ09999999999")).toBe(true); // Bundesbank test id
    expect(creditorIdValid("DE98ABC09999999999")).toBe(true); // business code is not checked
    expect(creditorIdValid("DE97ZZZ09999999999")).toBe(false);
    expect(creditorIdValid("DE00ZZZ00000000000")).toBe(false); // upstream placeholder
  });
  it("checks BICs", () => {
    expect(bicValid("COBADEFFXXX")).toBe(true);
    expect(bicValid("COBADEFF")).toBe(true);
    expect(bicValid("COBA")).toBe(false);
  });
});

describe("nexrees: BIC and mandate reference as the bank checks them", () => {
  it("accepts BICs only in the pain.008 schema pattern", async () => {
    const { bicValid } = await import("./sepa-validate");
    expect(bicValid("COBADEFFXXX")).toBe(true);
    expect(bicValid("MARKDEF1100")).toBe(true);
    expect(bicValid("DEUTDEFF")).toBe(true);
    expect(bicValid("ABCDEF10")).toBe(false); // 7th char 0/1 not allowed
    expect(bicValid("ABCDEF2O")).toBe(false); // 8th char O not allowed
  });

  it("checks the mandate reference instead of cleaning it", async () => {
    const { mandateRefValid } = await import("./sepa-validate");
    expect(mandateRefValid("M-2026/0001")).toBe(true);
    expect(mandateRefValid("MND 0001")).toBe(false); // blank
    expect(mandateRefValid("MND_0001")).toBe(false); // underscore
    expect(mandateRefValid("MÜLLER03")).toBe(false); // umlaut
    expect(mandateRefValid("/M1")).toBe(false);
    expect(mandateRefValid("M1/")).toBe(false);
    expect(mandateRefValid("M//1")).toBe(false);
    expect(mandateRefValid("x".repeat(36))).toBe(false);
  });
});
