import { authenticateBearer } from "@/lib/api-auth";
import { listDocuments } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, ?q, filters propertyId, unitId, personId), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listDocuments(p.tenantId, { ...pg, propertyId: stringParam(sp, "propertyId"), unitId: stringParam(sp, "unitId"), personId: stringParam(sp, "personId") }), { q: true });
});
