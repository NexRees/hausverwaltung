import { authenticateBearer } from "@/lib/api-auth";
import { listLeases } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam, boolParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, ?q, filters unitId, propertyId, personId, active), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listLeases(p.tenantId, { ...pg, unitId: stringParam(sp, "unitId"), propertyId: stringParam(sp, "propertyId"), personId: stringParam(sp, "personId"), active: boolParam(sp, "active") }), { q: true });
});
