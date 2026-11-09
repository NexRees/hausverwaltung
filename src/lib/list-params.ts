// nexrees: server-side paging and text filter for long lists (units, leases, people, tickets,
// documents). Lists used to load every row and render a full edit dialog per row, which ran the
// server out of memory at ~2,000 units (see docs/nexrees/scale-test.md).

export const LIST_PAGE_SIZE = 50;

export type ListParams = { page: number; q: string; skip: number; take: number };

export function listParams(sp: { page?: string; q?: string }, pageSize = LIST_PAGE_SIZE): ListParams {
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);
  return { page, q, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageCount(total: number, pageSize = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Query string for page `p`, keeping the other filters. Page 1 and empty values are left out. */
export function listHref(path: string, query: Record<string, string | undefined>, p: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v && k !== "page") qs.set(k, v);
  if (p > 1) qs.set("page", String(p));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Case-insensitive "contains" filter for Prisma string fields. */
export const icontains = (q: string) => ({ contains: q, mode: "insensitive" as const });
