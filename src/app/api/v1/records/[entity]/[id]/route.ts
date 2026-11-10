import { authenticateBearer } from "@/lib/api-auth";
import { apiUpdate, apiDelete } from "@/lib/api-write";
import { readRecord } from "@/lib/api-read";
import { safeHandler, unauthorizedJson, jsonError, readJsonBody } from "@/lib/api-http";

type Ctx = { params: Promise<{ entity: string; id: string }> };

// nexrees: single-record read with a field whitelist per entity (src/lib/api-read.ts)
export const GET = safeHandler(async (req: Request, { params }: Ctx) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const { entity, id } = await params;
  const row = await readRecord(p.tenantId, entity, id);
  if (!row) return jsonError(404, "not_found", "Nicht gefunden", { entity, id });
  return Response.json(row);
});

// nexrees: errors as { error, code } (ApiWriteError status kept), malformed JSON → 400 invalid_json
export const PATCH = safeHandler(async (req: Request, { params }: Ctx) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const { entity, id } = await params;
  const body = await readJsonBody(req);
  return Response.json(await apiUpdate(p, entity, id, body));
});

export const DELETE = safeHandler(async (req: Request, { params }: Ctx) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const { entity, id } = await params;
  return Response.json(await apiDelete(p, entity, id));
});
