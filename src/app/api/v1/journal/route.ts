// Copyright (c) 2026 NexRees.
import { authenticateBearer } from "@/lib/api-auth";
import { ApiHttpError, listResponse, safeHandler, unauthorizedJson, stringParam } from "@/lib/api-http";
import { isStaffRole } from "@/lib/staff-access";
import { listJournal } from "@/modules/ledger/core";
import { ledgerDb } from "@/modules/ledger/havewa";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function dayParam(sp: URLSearchParams, name: string): string | undefined {
  const v = stringParam(sp, name);
  if (v && !DAY.test(v)) throw new ApiHttpError(400, "invalid_parameter", `${name} muss ein Datum YYYY-MM-DD sein`, { parameter: name });
  return v;
}

// nexrees: journal of the general ledger, newest first, with the lines of every entry.
// Filters: from, to (YYYY-MM-DD), propertyId, accountId, q (text or entry number).
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  if (!isStaffRole(p.role)) throw new ApiHttpError(403, "forbidden", "Keine Berechtigung für das Hauptbuch");
  return listResponse(
    req,
    (pg, sp) =>
      listJournal(ledgerDb(), p.tenantId, {
        limit: pg.limit,
        offset: pg.offset,
        q: pg.q,
        from: dayParam(sp, "from"),
        to: dayParam(sp, "to"),
        propertyId: stringParam(sp, "propertyId"),
        accountId: stringParam(sp, "accountId"),
      }),
    { q: true },
  );
});
