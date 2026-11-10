import { authenticateBearer, unauthorized } from "@/lib/api-auth";
import { listOperations } from "@/lib/api-ops";
import { safeHandler } from "@/lib/api-http";

// Discovery: verfügbare Operationen (kein reines CRUD) mit Parametern.
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorized();
  return Response.json(listOperations());
});
