import { PersonType } from "@prisma/client";
import { authenticateBearer } from "@/lib/api-auth";
import { listPersons, createPerson } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, enumParam, readJsonBody, jsonError } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, ?q, filter type), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(req, (pg, sp) => listPersons(p.tenantId, { ...pg, type: enumParam(sp, "type", Object.values(PersonType)) }), { q: true });
});

export const POST = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const body = await readJsonBody(req); // nexrees: 400 invalid_json instead of a misleading field error
  if (!body.firstName || !body.lastName) {
    return jsonError(400, "validation_error", "firstName und lastName erforderlich", { fields: ["firstName", "lastName"] });
  }
  return Response.json(await createPerson(p.tenantId, body as Parameters<typeof createPerson>[1]), { status: 201 });
});
