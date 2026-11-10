import { authenticateBearer } from "@/lib/api-auth";
import { listAppointments } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg) => listAppointments(p.tenantId, pg));
});
