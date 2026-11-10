import { authenticateBearer, unauthorized } from "@/lib/api-auth";
import { apiCreate } from "@/lib/api-write";
import { readJsonBody, safeHandler } from "@/lib/api-http";

// nexrees: errors in the shared shape { error, code } (ApiWriteError's status picks the code);
// a malformed body is 400 invalid_json instead of an empty record.
export const POST = safeHandler(async (req: Request, { params }: { params: Promise<{ entity: string }> }) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorized();
  const { entity } = await params;
  return Response.json(await apiCreate(p, entity, await readJsonBody(req)), { status: 201 });
});
