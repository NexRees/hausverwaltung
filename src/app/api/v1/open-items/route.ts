import { authenticateBearer } from "@/lib/api-auth";
import { listOpenItems } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam, boolParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, filters leaseId, overdue), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listOpenItems(p.tenantId, { ...pg, leaseId: stringParam(sp, "leaseId"), overdue: boolParam(sp, "overdue") }));
});
