import { authenticateBearer } from "@/lib/api-auth";
import { getProperty } from "@/lib/api-data";
import { safeHandler, unauthorizedJson, jsonError } from "@/lib/api-http";

// nexrees: JSON errors with a code
export const GET = safeHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const { id } = await params;
  const r = await getProperty(p.tenantId, id);
  if (!r) return jsonError(404, "not_found", "Not found");
  return Response.json(r);
});
