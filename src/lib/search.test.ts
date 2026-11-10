import { describe, expect, it } from "vitest";
import { tokenizedWhere, searchTokens, appHref } from "./search";

const ci = (contains: string) => ({ contains, mode: "insensitive" });

describe("tokenizedWhere", () => {
  it("ANDs the words and ORs each word across the fields", () => {
    expect(tokenizedWhere("Erika Mustermann", ["firstName", "lastName"])).toEqual({
      AND: [
        { OR: [{ firstName: ci("Erika") }, { lastName: ci("Erika") }] },
        { OR: [{ firstName: ci("Mustermann") }, { lastName: ci("Mustermann") }] },
      ],
    });
  });
  it("nests dot paths into relation filters", () => {
    expect(tokenizedWhere("Muster", ["renters.some.person.lastName", "unit.label"])).toEqual({
      AND: [{ OR: [{ renters: { some: { person: { lastName: ci("Muster") } } } }, { unit: { label: ci("Muster") } }] }],
    });
  });
  it("returns no filter for an empty query", () => {
    expect(tokenizedWhere("", ["name"])).toEqual({});
    expect(tokenizedWhere("   ", ["name"])).toEqual({});
    expect(tokenizedWhere(undefined, ["name"])).toEqual({});
    expect(tokenizedWhere("x", [])).toEqual({});
  });
});

describe("searchTokens", () => {
  it("splits on any whitespace, drops duplicates (case-insensitive) and caps at 6 words", () => {
    expect(searchTokens("  WE\t12   we  Musterstraße ")).toEqual(["WE", "12", "Musterstraße"]);
    expect(searchTokens("a b c d e f g h")).toHaveLength(6);
  });
});

describe("appHref", () => {
  it("links people to their own page", () => {
    expect(appHref("person", "p1")).toBe("/persons/p1");
    expect(appHref("unit", "u1")).toBe("/units/u1");
    expect(appHref("ticket", "t1", "Heizung defekt")).toBe("/tickets?q=Heizung%20defekt");
    expect(appHref("charge", "c1")).toBeNull();
  });
});
