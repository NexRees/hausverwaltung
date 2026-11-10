import { describe, expect, it } from "vitest";
import { companyContact, contactEmail, telHref } from "./portal-contact";

describe("telHref", () => {
  it("keeps digits and a leading plus", () => {
    expect(telHref("030 / 123 45-6")).toBe("tel:030123456");
    expect(telHref("+49 (0)30 123456")).toBe("tel:+4930123456");
    expect(telHref("(0)30 123456")).toBe("tel:030123456");
  });
  it("returns null without a usable number", () => {
    expect(telHref("tbd")).toBeNull();
  });
});

describe("contactEmail", () => {
  it("takes the address out of a display name", () => {
    expect(contactEmail('"Muster HV" <verwaltung@muster-hv.de>')).toBe("verwaltung@muster-hv.de");
    expect(contactEmail(" verwaltung@muster-hv.de ")).toBe("verwaltung@muster-hv.de");
  });
  it("hides no-reply and invalid addresses", () => {
    expect(contactEmail("noreply@muster-hv.de")).toBeNull();
    expect(contactEmail("No-Reply@muster-hv.de")).toBeNull();
    expect(contactEmail("verwaltung")).toBeNull();
    expect(contactEmail(null)).toBeNull();
  });
});

describe("companyContact", () => {
  it("splits the address into lines", () => {
    expect(companyContact({ address: "Musterstr. 1, 10115 Berlin" }).addressLines).toEqual(["Musterstr. 1", "10115 Berlin"]);
    expect(companyContact({ address: "Musterstr. 1\n\n10115 Berlin\n" }).addressLines).toEqual(["Musterstr. 1", "10115 Berlin"]);
  });
  it("is empty without settings", () => {
    expect(companyContact({})).toEqual({ addressLines: [], phone: null, phoneHref: null, email: null });
  });
});
