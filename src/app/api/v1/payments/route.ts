import { authenticateBearer } from "@/lib/api-auth";
import { listPayments } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, filters accountId, chargeId), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listPayments(p.tenantId, { ...pg, accountId: stringParam(sp, "accountId"), chargeId: stringParam(sp, "chargeId") }));
});
