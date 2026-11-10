import { authenticateBearer, unauthorized } from "@/lib/api-auth";
import { runOperation } from "@/lib/api-ops";
import { ApiHttpError, readJsonBody, safeHandler } from "@/lib/api-http";
import { periodLockMessage } from "@/server/ledger";

// nexrees: errors in the shared shape { error, code }. Operations without required parameters
// (e.g. run_dunning) still accept an empty body; a malformed one is 400 invalid_json.
export const POST = safeHandler(async (req: Request, { params }: { params: Promise<{ op: string }> }) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorized();
  const { op } = await params;
  const hasBody = (await req.clone().text()).trim() !== "";
  const body = hasBody ? await readJsonBody(req) : {};
  try {
    return Response.json(await runOperation(p, op, body));
  } catch (e) {
    // nexrees: closed booking period (raw trigger error or PeriodLockedError) → 409 period_locked
    const locked = periodLockMessage(e);
    if (locked) throw new ApiHttpError(409, "period_locked", locked);
    throw e;
  }
});
