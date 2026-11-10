// nexrees: shared HTTP helpers for /api/v1. One JSON error shape ({ error, code }), paging with
// X-Total-Count and Link headers, and a wrapper that turns unexpected throws into a JSON 500
// instead of an HTML page or a leaked stack trace. Agents and integrations rely on these.

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
/** Rows a list returns when the caller sends no paging parameters (old clients). */
export const LEGACY_CEILING = 5000;
export const MAX_Q_LENGTH = 100;

/** Error with an HTTP status and a stable machine-readable code. */
export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  422: "unprocessable",
  429: "rate_limited",
};

/** Stable code for a status, used when an error carries only a status. */
export function codeForStatus(status: number): string {
  return CODES[status] ?? (status >= 500 ? "internal_error" : "error");
}

/** `{ error: message, code, ...extra }`. `error` stays a string so old clients keep working. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  return Response.json({ ...extra, error: message, code }, { status, headers });
}

export function unauthorizedJson(): Response {
  return jsonError(401, "unauthorized", "Unauthorized — Bearer-Token fehlt oder ungültig", undefined, {
    "WWW-Authenticate": "Bearer",
  });
}

/** Maps a thrown error to a JSON response; anything unknown becomes a 500 without internals. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ApiHttpError) return jsonError(e.status, e.code, e.message, e.extra);
  // Errors from the write layer (ApiWriteError) carry a 4xx status and a user-facing message.
  const status = (e as { status?: unknown } | null)?.status;
  if (e instanceof Error && typeof status === "number" && status >= 400 && status < 500) {
    const code = (e as { code?: unknown }).code;
    return jsonError(status, typeof code === "string" ? code : codeForStatus(status), e.message);
  }
  console.error("[api] unexpected error", e);
  return jsonError(500, "internal_error", "Interner Fehler");
}

/** Wraps a route handler so that unexpected throws answer JSON (500 internal_error). */
export function safeHandler<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Request body as JSON object; throws 400 invalid_json for malformed or non-object bodies. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiHttpError(400, "invalid_json", "Ungültiger JSON-Body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiHttpError(400, "invalid_json", "JSON-Body muss ein Objekt sein");
  }
  return body as Record<string, unknown>;
}

export type Paging = {
  limit: number;
  offset: number;
  q?: string;
  /** false: no paging parameter sent, the list answers a plain array up to LEGACY_CEILING rows */
  paged: boolean;
};

const intParam = (v: string | null) => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : NaN;
};

/**
 * Paging from `?limit=&offset=&q=`. Any of them switches to paging (default 100, max 500).
 * Without them the old behaviour stays: everything, but at most LEGACY_CEILING rows.
 */
export function parsePaging(url: URL | string): Paging {
  const sp = (typeof url === "string" ? new URL(url, "http://x") : url).searchParams;
  const rawQ = sp.get("q");
  const q = rawQ?.trim().slice(0, MAX_Q_LENGTH) || undefined;
  const paged = sp.has("limit") || sp.has("offset") || rawQ != null;
  const limit = intParam(sp.get("limit"));
  const offset = intParam(sp.get("offset"));
  if (Number.isNaN(limit)) throw new ApiHttpError(400, "invalid_parameter", "limit muss eine Zahl sein", { parameter: "limit" });
  if (Number.isNaN(offset)) throw new ApiHttpError(400, "invalid_parameter", "offset muss eine Zahl sein", { parameter: "offset" });
  if (!paged) return { limit: LEGACY_CEILING, offset: 0, paged: false };
  return {
    limit: Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT)),
    offset: Math.max(0, offset ?? 0),
    q,
    paged: true,
  };
}

/** Optional enum query parameter (case-insensitive); 400 invalid_parameter for other values. */
export function enumParam<T extends string>(sp: URLSearchParams, name: string, values: readonly T[]): T | undefined {
  const v = sp.get(name)?.trim();
  if (!v) return undefined;
  const hit = values.find((x) => x.toLowerCase() === v.toLowerCase());
  if (!hit) {
    throw new ApiHttpError(400, "invalid_parameter", `${name}: eines von ${values.join(", ")}`, { parameter: name, allowed: values });
  }
  return hit;
}

/** Optional boolean query parameter: true/1 or false/0; 400 invalid_parameter otherwise. */
export function boolParam(sp: URLSearchParams, name: string): boolean | undefined {
  const v = sp.get(name)?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new ApiHttpError(400, "invalid_parameter", `${name}: true oder false`, { parameter: name });
}

/** Optional string query parameter (e.g. an id filter); empty means absent. */
export function stringParam(sp: URLSearchParams, name: string): string | undefined {
  return sp.get(name)?.trim() || undefined;
}

export type Page<T> = { items: T[]; total: number };

/** Link header value for the next page, relative to the request path (no host leaks). */
export function nextLink(url: URL, offset: number, limit: number): string {
  const next = new URL(url.toString());
  next.searchParams.set("limit", String(limit));
  next.searchParams.set("offset", String(offset));
  return `<${next.pathname}${next.search}>; rel="next"`;
}

/**
 * JSON array of one page plus X-Total-Count and, when more rows exist, a `rel="next"` Link.
 * A legacy (unpaged) answer cut at LEGACY_CEILING also says X-Result-Truncated: true.
 */
export function pageResponse<T>(req: Request, paging: Paging, page: Page<T>): Response {
  const url = new URL(req.url);
  const headers = new Headers({ "X-Total-Count": String(page.total) });
  const end = paging.offset + page.items.length;
  if (end < page.total) {
    headers.set("Link", nextLink(url, end, paging.paged ? paging.limit : MAX_LIMIT));
    if (!paging.paged) headers.set("X-Result-Truncated", "true");
  }
  return Response.json(page.items, { headers });
}

/**
 * Standard list GET: parses paging, rejects `q` where the list has no text search (so a filter
 * is never silently ignored), loads one page and answers with the paging headers.
 */
export async function listResponse<T>(
  req: Request,
  load: (paging: Paging, sp: URLSearchParams) => Promise<Page<T>>,
  opts: { q?: boolean } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const paging = parsePaging(url);
  if (paging.q && !opts.q) {
    throw new ApiHttpError(400, "unsupported_parameter", "q (Freitextsuche) wird für diese Liste nicht unterstützt", { parameter: "q" });
  }
  return pageResponse(req, paging, await load(paging, url.searchParams));
}
