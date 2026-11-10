import { TicketStatus } from "@prisma/client";
import { authenticateBearer } from "@/lib/api-auth";
import { listTickets, createTicket } from "@/lib/api-data";
import { listResponse, safeHandler, unauthorizedJson, stringParam, enumParam, readJsonBody, jsonError } from "@/lib/api-http";

// nexrees: paged (?limit, ?offset, ?q, filters status, propertyId, unitId), X-Total-Count + Link headers, JSON errors
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  return listResponse(
    req,
    (pg, sp) =>
      listTickets(p.tenantId, {
        ...pg,
        status: enumParam(sp, "status", Object.values(TicketStatus)),
        propertyId: stringParam(sp, "propertyId"),
        unitId: stringParam(sp, "unitId"),
      }),
    { q: true },
  );
});

export const POST = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  const body = await readJsonBody(req); // nexrees: 400 invalid_json instead of a misleading field error
  if (!body.title) return jsonError(400, "validation_error", "title erforderlich", { fields: ["title"] });
  return Response.json(await createTicket(p.tenantId, body as Parameters<typeof createTicket>[1]), { status: 201 });
});
