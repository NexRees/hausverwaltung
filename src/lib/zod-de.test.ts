import { describe, expect, it } from "vitest";
import { z } from "zod";
import { invalid } from "./schemas"; // installs the German messages

describe("German validation messages", () => {
  const schema = z.object({
    name: z.string().trim().min(1),
    email: z.email(),
    area: z.coerce.number().min(0),
    kind: z.enum(["A", "B"]),
    custom: z.string().min(3, "Eigene Meldung"),
  });

  it("uses plain German instead of zod's English defaults", () => {
    const r = schema.safeParse({ name: " ", email: "x", area: "-1", kind: "C", custom: "ab" });
    expect(r.success).toBe(false);
    const state = invalid(r.error!);
    expect(state.fieldErrors).toEqual({
      name: "Pflichtfeld – bitte ausfüllen.",
      email: "Bitte eine gültige E-Mail-Adresse eingeben.",
      area: "Muss mindestens 0 sein.",
      kind: "Bitte einen gültigen Wert auswählen.",
      custom: "Eigene Meldung", // a schema's own message still wins
    });
    expect(state.error).toBe("Pflichtfeld – bitte ausfüllen.");
  });

  it("reports a missing field as required, and keeps only the first message per field", () => {
    const r = z.object({ title: z.string().min(5).max(3) }).safeParse({});
    const state = invalid(r.error!);
    expect(state.fieldErrors).toEqual({ title: "Pflichtfeld – bitte ausfüllen." });
  });
});
