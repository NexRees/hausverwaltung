import { describe, expect, it } from "vitest";
import { validateArgs, negotiateProtocol, toolAnnotations, toolResult, mcpPage, LATEST_PROTOCOL, type JsonSchema } from "./mcp-protocol";

const schema: JsonSchema = {
  type: "object",
  properties: {
    entity: { type: "string", enum: ["unit", "person"] },
    id: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    active: { type: "boolean" },
    data: { type: "object" },
  },
  required: ["entity", "id"],
  additionalProperties: false,
};

describe("validateArgs", () => {
  it("accepts valid arguments", () => {
    expect(validateArgs(schema, { entity: "unit", id: "u1", limit: 10, active: true, data: {} })).toEqual([]);
  });
  it("lists every missing required argument instead of passing \"undefined\"", () => {
    expect(validateArgs(schema, {})).toEqual([
      { field: "entity", problem: expect.stringContaining("required") },
      { field: "id", problem: expect.stringContaining("required") },
    ]);
    expect(validateArgs(schema, undefined).map((p) => p.field)).toEqual(["entity", "id"]);
    expect(validateArgs(schema, { entity: "unit", id: "  " }).map((p) => p.field)).toEqual(["id"]);
  });
  it("checks primitive types, enums and bounds", () => {
    const problems = validateArgs(schema, { entity: "lease", id: 5, limit: 500, active: "yes" });
    expect(problems.map((p) => p.field).sort()).toEqual(["active", "entity", "id", "limit"]);
    expect(validateArgs(schema, { entity: "unit", id: "u", limit: 1.5 })[0]).toMatchObject({ field: "limit", problem: expect.stringContaining("integer") });
    expect(validateArgs(schema, { entity: "unit", id: "u", data: [1] })[0]).toMatchObject({ field: "data" });
  });
  it("reports unknown arguments when the schema is closed, treats null as not sent", () => {
    expect(validateArgs(schema, { entity: "unit", id: "u", query: "x" })).toEqual([
      { field: "query", problem: expect.stringContaining("unknown") },
    ]);
    expect(validateArgs(schema, { entity: "unit", id: "u", limit: null })).toEqual([]);
    expect(validateArgs({ ...schema, additionalProperties: true }, { entity: "unit", id: "u", query: "x" })).toEqual([]);
  });
  it("rejects non-object arguments", () => {
    expect(validateArgs(schema, "unit")).toEqual([{ field: "(arguments)", problem: expect.any(String) }]);
  });
});

describe("negotiateProtocol", () => {
  it("echoes a supported version, else answers the latest", () => {
    expect(negotiateProtocol("2024-11-05")).toBe("2024-11-05");
    expect(negotiateProtocol("2025-03-26")).toBe("2025-03-26");
    expect(negotiateProtocol("2099-01-01")).toBe(LATEST_PROTOCOL);
    expect(negotiateProtocol(undefined)).toBe("2025-06-18");
  });
});

describe("toolAnnotations", () => {
  it("marks reads read-only and deletes/operations destructive", () => {
    for (const n of ["list_units", "get_record", "search", "portfolio_summary", "list_entities"]) {
      expect(toolAnnotations(n)).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
    expect(toolAnnotations("delete_record")).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations("run_operation")).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(toolAnnotations("create_ticket")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });
});

describe("toolResult / mcpPage", () => {
  it("adds structuredContent for objects only", () => {
    expect(toolResult({ a: 1 })).toEqual({ content: [{ type: "text", text: '{"a":1}' }], structuredContent: { a: 1 } });
    expect(toolResult([1])).toEqual({ content: [{ type: "text", text: "[1]" }] });
  });
  it("computes nextOffset", () => {
    expect(mcpPage({ items: [1, 2], total: 5 }, 0, 2)).toEqual({ items: [1, 2], total: 5, offset: 0, limit: 2, nextOffset: 2 });
    expect(mcpPage({ items: [5], total: 5 }, 4, 2).nextOffset).toBeNull();
  });
});
