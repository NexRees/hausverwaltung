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
