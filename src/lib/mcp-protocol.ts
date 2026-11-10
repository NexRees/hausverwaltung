// nexrees: protocol helpers for the MCP server (src/app/api/mcp/route.ts), kept out of the route
// file so they can be unit-tested: argument validation against a tool's inputSchema, protocol
// version negotiation, tool annotations and the tools/call result shape.

export const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];

/** The client's version when we speak it, else our latest (the client then decides). */
export function negotiateProtocol(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL;
}

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | object;
  items?: JsonSchema;
  description?: string;
  default?: unknown;
};

export type ArgProblem = { field: string; problem: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(type: string, v: unknown): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return isPlainObject(v);
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}

/**
 * Checks tools/call arguments against the tool's inputSchema (top level: required keys, primitive
 * types, enums, numeric bounds, unknown keys when additionalProperties is false). `null` counts
 * as "not sent". Returns every problem, empty when the arguments are fine.
 */
export function validateArgs(schema: JsonSchema, args: unknown): ArgProblem[] {
  if (args === undefined || args === null) args = {};
  if (!isPlainObject(args)) return [{ field: "(arguments)", problem: "muss ein Objekt sein (must be an object)" }];
  const props = schema.properties ?? {};
  const problems: ArgProblem[] = [];
  for (const key of schema.required ?? []) {
    const v = args[key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "" && props[key]?.type === "string")) {
      problems.push({ field: key, problem: "fehlt (required)" });
    }
  }
  for (const [key, v] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        const allowed = Object.keys(props);
        problems.push({ field: key, problem: `unbekanntes Argument (unknown; allowed: ${allowed.join(", ") || "none"})` });
      }
      continue;
    }
    if (v === undefined || v === null) continue;
    if (prop.type && !matchesType(prop.type, v)) {
      problems.push({ field: key, problem: `erwartet ${prop.type}, erhalten ${typeOf(v)} (expected ${prop.type})` });
      continue;
    }
    if (prop.enum && !prop.enum.includes(v)) {
      problems.push({ field: key, problem: `muss einer von ${prop.enum.join(", ")} sein (must be one of)` });
      continue;
    }
    if (typeof v === "number") {
      if (prop.minimum !== undefined && v < prop.minimum) problems.push({ field: key, problem: `mindestens ${prop.minimum} (minimum)` });
      if (prop.maximum !== undefined && v > prop.maximum) problems.push({ field: key, problem: `höchstens ${prop.maximum} (maximum)` });
    }
  }
  return problems;
}

export function formatProblems(problems: ArgProblem[]): string {
  return `Ungültige Argumente (invalid arguments): ${problems.map((p) => `${p.field}: ${p.problem}`).join("; ")}`;
}

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

/** MCP tool annotations from the tool name (read-only lists/reads, destructive deletes and operations). */
export function toolAnnotations(name: string): ToolAnnotations {
  const readOnly = /^(list_|get_)/.test(name) || name === "search" || name === "portfolio_summary";
  if (readOnly) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  switch (name) {
    case "delete_record": // cascades (property → buildings → units → leases → charges …)
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    case "update_record": // overwrites values; the same call twice has the same effect
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    case "run_operation": // charge runs, dunning, bank import, sending e-mail to people outside
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
    default: // create_*: additive, each call adds a record
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  }
}

/** tools/call result: JSON text for every client plus structuredContent for object results. */
export function toolResult(result: unknown): { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown> } {
  const text = JSON.stringify(result ?? null);
  return isPlainObject(result) ? { content: [{ type: "text", text }], structuredContent: result } : { content: [{ type: "text", text }] };
}

export type McpPage<T> = { items: T[]; total: number; offset: number; limit: number; nextOffset: number | null };

export const MCP_DEFAULT_LIMIT = 50;
export const MCP_MAX_LIMIT = 200;

/** Paging envelope for MCP list tools. */
export function mcpPage<T>(page: { items: T[]; total: number }, offset: number, limit: number): McpPage<T> {
  const end = offset + page.items.length;
  return { items: page.items, total: page.total, offset, limit, nextOffset: end < page.total ? end : null };
}
