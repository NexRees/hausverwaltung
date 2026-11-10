import { authenticateBearer } from "@/lib/api-auth";
import { listTasks, createTask } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, boolParam, readJsonBody, jsonError } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, filter done), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listTasks(p.tenantId, { ...pg, done: boolParam(sp, "done") }));
});

export const POST = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const body = await readJsonBody(req); // nexrees: 400 invalid_json instead of a misleading field error
  if (!body.title) return jsonError(400, "validation_error", "title erforderlich", { fields: ["title"] });
  const created = await createTask(p.tenantId, {
    title: String(body.title),
    dueDate: typeof body.dueDate === "string" ? body.dueDate : undefined,
  });
  return Response.json(created, { status: 201 });
});
