import { describe, expect, it, vi } from "vitest";
import {
  parsePaging,
  pageResponse,
  jsonError,
  errorResponse,
  safeHandler,
  readJsonBody,
  enumParam,
  boolParam,
  listResponse,
  ApiHttpError,
  LEGACY_CEILING,
} from "./api-http";

const url = (qs: string) => `http://localhost/api/v1/charges${qs}`;

describe("parsePaging", () => {
  it("keeps the legacy behaviour without paging parameters (capped at 5,000)", () => {
    expect(parsePaging(url(""))).toEqual({ limit: LEGACY_CEILING, offset: 0, paged: false });
    expect(parsePaging(url("?leaseId=x"))).toMatchObject({ paged: false });
  });
  it("pages as soon as limit, offset or q is sent", () => {
    expect(parsePaging(url("?limit=5"))).toEqual({ limit: 5, offset: 0, q: undefined, paged: true });
    expect(parsePaging(url("?offset=20"))).toMatchObject({ limit: 100, offset: 20, paged: true });
    expect(parsePaging(url("?q=%20M%C3%BCller%20"))).toMatchObject({ limit: 100, q: "Müller", paged: true });
  });
  it("clamps limit to 1..500 and offset to >= 0", () => {
    expect(parsePaging(url("?limit=100000")).limit).toBe(500);
    expect(parsePaging(url("?limit=0")).limit).toBe(1);
    expect(parsePaging(url("?limit=2.9")).limit).toBe(2);
    expect(parsePaging(url("?offset=-4")).offset).toBe(0);
  });
  it("rejects an offset beyond what the database accepts (400, not a 500)", () => {
    expect(parsePaging(url("?offset=2147483647")).offset).toBe(2147483647);
    expect(() => parsePaging(url("?offset=2147483648"))).toThrow(expect.objectContaining({ status: 400, code: "invalid_parameter" }));
    expect(() => parsePaging(url("?offset=1e300"))).toThrow(ApiHttpError);
  });
  it("rejects non-numeric limit/offset with a 400 invalid_parameter", () => {
    expect(() => parsePaging(url("?limit=abc"))).toThrow(ApiHttpError);
    try {
      parsePaging(url("?offset=x"));
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: "invalid_parameter" });
    }
  });
  it("bounds q to 100 characters", () => {
    expect(parsePaging(url(`?q=${"x".repeat(300)}`)).q).toHaveLength(100);
  });
});

describe("pageResponse", () => {
  it("sends X-Total-Count and a relative next link while rows remain", async () => {
    const req = new Request(url("?limit=2&leaseId=L1"));
    const res = pageResponse(req, parsePaging(req.url), { items: [1, 2], total: 5 });
    expect(res.headers.get("X-Total-Count")).toBe("5");
    expect(res.headers.get("Link")).toBe('</api/v1/charges?limit=2&leaseId=L1&offset=2>; rel="next"');
    expect(res.headers.get("X-Result-Truncated")).toBeNull();
    expect(await res.json()).toEqual([1, 2]);
  });
  it("omits the link on the last page", () => {
    const req = new Request(url("?limit=2&offset=4"));
    const res = pageResponse(req, parsePaging(req.url), { items: [5], total: 5 });
    expect(res.headers.get("Link")).toBeNull();
  });
  it("marks a truncated legacy answer and links to the next 500", () => {
    const req = new Request(url(""));
    const res = pageResponse(req, parsePaging(req.url), { items: new Array(LEGACY_CEILING).fill(0), total: 56871 });
    expect(res.headers.get("X-Result-Truncated")).toBe("true");
    expect(res.headers.get("Link")).toBe('</api/v1/charges?limit=500&offset=5000>; rel="next"');
  });
});

describe("errors", () => {
  it("jsonError keeps `error` a string and adds a code", async () => {
    const res = jsonError(404, "not_found", "Nicht gefunden", { id: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ id: "x", error: "Nicht gefunden", code: "not_found" });
  });
  it("maps errors with a 4xx status (ApiWriteError) and hides everything else", async () => {
    class WriteError extends Error {
      status = 405;
    }
    const known = errorResponse(new WriteError("unit ist nicht aktualisierbar"));
    expect(known.status).toBe(405);
    expect(await known.json()).toEqual({ error: "unit ist nicht aktualisierbar", code: "method_not_allowed" });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = errorResponse(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    expect(unknown.status).toBe(500);
    const body = await unknown.json();
    expect(body).toEqual({ error: "Interner Fehler", code: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    spy.mockRestore();
  });
  it("safeHandler turns throws into JSON", async () => {
    const h = safeHandler(async () => {
      throw new ApiHttpError(400, "invalid_parameter", "status: eines von A, B", { parameter: "status" });
    });
    const res = await h(new Request(url("")));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_parameter", parameter: "status" });
  });
  it("readJsonBody answers 400 invalid_json for malformed or non-object bodies", async () => {
    const post = (body: string) => new Request(url(""), { method: "POST", body });
    await expect(readJsonBody(post("{nope"))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
    await expect(readJsonBody(post("[1]"))).rejects.toMatchObject({ code: "invalid_json" });
    await expect(readJsonBody(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });
});

describe("query parameters", () => {
  const sp = (qs: string) => new URLSearchParams(qs);
  it("enumParam is case-insensitive and rejects unknown values", () => {
    expect(enumParam(sp("status=overdue"), "status", ["OPEN", "OVERDUE"])).toBe("OVERDUE");
    expect(enumParam(sp(""), "status", ["OPEN"])).toBeUndefined();
    expect(() => enumParam(sp("status=late"), "status", ["OPEN"])).toThrow(/status/);
  });
  it("boolParam accepts true/false/1/0", () => {
    expect(boolParam(sp("active=true"), "active")).toBe(true);
    expect(boolParam(sp("active=0"), "active")).toBe(false);
    expect(boolParam(sp(""), "active")).toBeUndefined();
    expect(() => boolParam(sp("active=yes"), "active")).toThrow(ApiHttpError);
  });
  it("listResponse refuses q on a list without text search", async () => {
    const load = vi.fn();
    await expect(listResponse(new Request(url("?q=x")), load)).rejects.toMatchObject({ code: "unsupported_parameter" });
    expect(load).not.toHaveBeenCalled();
  });
});
