import { describe, expect, it } from "vitest";
import { escapeLike, normalizeEmail, pickLoginUser } from "./login-email";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("Mieter@HaVeWa.app")).toBe("mieter@havewa.app");
    expect(normalizeEmail("  admin@havewa.app\t")).toBe("admin@havewa.app");
  });

  it("returns an empty string for anything but a string", () => {
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(42)).toBe("");
    expect(normalizeEmail("   ")).toBe("");
  });
});

describe("escapeLike", () => {
  it("escapes ILIKE wildcards and the escape character", () => {
    expect(escapeLike("a_b%c\\d@x.de")).toBe("a\\_b\\%c\\\\d@x.de");
    expect(escapeLike("mieter@havewa.app")).toBe("mieter@havewa.app");
  });
});

describe("pickLoginUser", () => {
  const lower = { id: "1", email: "max@firma.de" };
  const upper = { id: "2", email: "Max@Firma.de" };
  const other = { id: "3", email: "moritz@firma.de" };

  it("finds a user stored in another case", () => {
    expect(pickLoginUser([upper], "MAX@firma.DE")).toBe(upper);
  });

  it("prefers the exact lower-case match when case variants exist", () => {
    expect(pickLoginUser([upper, lower], "Max@Firma.de")).toBe(lower);
  });

  it("refuses ambiguous case variants without an exact match", () => {
    expect(pickLoginUser([upper, { id: "4", email: "MAX@firma.de" }], "max@firma.de")).toBeNull();
  });

  it("ignores candidates that only matched a wildcard", () => {
    expect(pickLoginUser([other], "m_ritz@firma.de")).toBeNull();
  });

  it("returns null for no candidates or an empty e-mail", () => {
    expect(pickLoginUser([], "max@firma.de")).toBeNull();
    expect(pickLoginUser([lower], "")).toBeNull();
  });
});
