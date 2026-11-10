import { describe, it, expect } from "vitest";
import { passwordProblem } from "./password-policy";

describe("passwordProblem", () => {
  it("accepts a long, unusual password", () => {
    expect(passwordProblem("Kaffee-Tasse-Fenster-7")).toBeNull();
  });
  it("rejects short, repeated, common and e-mail passwords", () => {
    expect(passwordProblem("kurz123")).toMatch(/zu kurz/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toMatch(/einem Zeichen/);
    expect(passwordProblem("Passwort1234")).toMatch(/verbreitet/);
    expect(passwordProblem("maria.mustermann", "Maria.Mustermann@example.de")).toMatch(/E-Mail/);
  });
  it("rejects passwords bcrypt would truncate", () => {
    expect(passwordProblem("ä".repeat(40))).toMatch(/zu lang/);
  });
});
