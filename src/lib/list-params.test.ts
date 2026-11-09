import { describe, expect, it } from "vitest";
import { listParams, listHref, pageCount } from "./list-params";

describe("listParams", () => {
  it("defaults to page 1 and an empty filter", () => {
    expect(listParams({})).toEqual({ page: 1, q: "", skip: 0, take: 50 });
  });
  it("clamps bad page numbers", () => {
    expect(listParams({ page: "-3" }).page).toBe(1);
    expect(listParams({ page: "abc" }).page).toBe(1);
    expect(listParams({ page: "2.7" }).page).toBe(2);
    expect(listParams({ page: "3" }, 20)).toMatchObject({ skip: 40, take: 20 });
  });
  it("trims and bounds the filter", () => {
    expect(listParams({ q: "  Müller " }).q).toBe("Müller");
    expect(listParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("listHref / pageCount", () => {
  it("keeps filters and drops page 1", () => {
    expect(listHref("/units", { q: "WE 1", page: "4" }, 1)).toBe("/units?q=WE+1");
    expect(listHref("/units", { q: "", type: "MIETER" }, 3)).toBe("/units?type=MIETER&page=3");
  });
  it("never returns zero pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(101)).toBe(3);
  });
});
