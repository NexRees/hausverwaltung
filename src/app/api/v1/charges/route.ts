import { authenticateBearer } from "@/lib/api-auth";
import { listCharges, CHARGE_FILTER_STATUSES } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam, enumParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, filters leaseId, status), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listCharges(p.tenantId, { ...pg, leaseId: stringParam(sp, "leaseId"), status: enumParam(sp, "status", CHARGE_FILTER_STATUSES) }));
});
