import { authenticateBearer, unauthorized } from "@/lib/api-auth";
import { listEntities } from "@/lib/api-write";
import { safeHandler } from "@/lib/api-http";

// Schema-Discovery: welche Entitäten schreibbar sind + ihre Felder.
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorized();
  return Response.json(listEntities());
});
