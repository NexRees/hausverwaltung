import { authenticateBearer } from "@/lib/api-auth";
import { listOwners } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, filters unitId, personId), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listOwners(p.tenantId, { ...pg, unitId: stringParam(sp, "unitId"), personId: stringParam(sp, "personId") }));
});
