// nexrees: search across record types for integrations and agents (same logic as the staff search page)
import { authenticateBearer } from "@/lib/api-auth";
import { searchEntities, SEARCH_ENTITIES, type SearchEntity } from "@/lib/search";
import { safeHandler, unauthorizedJson, jsonError, ApiHttpError } from "@/lib/api-http";

export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  if (!q) return jsonError(400, "invalid_parameter", "q (Suchbegriff) erforderlich", { parameter: "q" });
  const limitRaw = sp.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 10;
  if (!Number.isFinite(limit)) throw new ApiHttpError(400, "invalid_parameter", "limit muss eine Zahl sein", { parameter: "limit" });
  const entities = (sp.get("entities") ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const unknown = entities.filter((e) => !(SEARCH_ENTITIES as readonly string[]).includes(e));
  if (unknown.length) {
    return jsonError(400, "invalid_parameter", `entities: unbekannt ${unknown.join(", ")}`, { parameter: "entities", allowed: SEARCH_ENTITIES });
  }
  const r = await searchEntities(p.tenantId, q, { limit, entities: entities as SearchEntity[] });
  return Response.json({
    q: r.q,
    total: r.total,
    counts: Object.fromEntries(r.groups.map((g) => [g.entity, g.total])),
    hits: r.hits,
  });
});
