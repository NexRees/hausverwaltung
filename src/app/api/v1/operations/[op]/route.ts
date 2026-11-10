import { authenticateBearer, unauthorized } from "@/lib/api-auth";
import { runOperation } from "@/lib/api-ops";
import { readJsonBody, safeHandler } from "@/lib/api-http";

// nexrees: errors in the shared shape { error, code }. Operations without required parameters
// (e.g. run_dunning) still accept an empty body; a malformed one is 400 invalid_json.
export const POST = safeHandler(async (req: Request, { params }: { params: Promise<{ op: string }> }) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorized();
  const { op } = await params;
  const hasBody = (await req.clone().text()).trim() !== "";
  return Response.json(await runOperation(p, op, hasBody ? await readJsonBody(req) : {}));
});
