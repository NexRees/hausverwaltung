// Copyright (c) 2026 NexRees.
import { authenticateBearer } from "@/lib/api-auth";
import { ApiHttpError, listResponse, safeHandler, unauthorizedJson, stringParam } from "@/lib/api-http";
import { isStaffRole } from "@/lib/staff-access";
import { listAccounts, trialBalance } from "@/modules/ledger/core";
import { ledgerDb } from "@/modules/ledger/havewa";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function dayParam(sp: URLSearchParams, name: string): string | undefined {
  const v = stringParam(sp, name);
  if (v && !DAY.test(v)) throw new ApiHttpError(400, "invalid_parameter", `${name} muss ein Datum YYYY-MM-DD sein`, { parameter: name });
  return v;
}

// nexrees: chart of accounts with balances (Summen- und Saldenliste). opening = balance before
// `from`, debit/credit = turnover in the range, closing = opening + debit - credit (debit positive).
// Filters: from, to (YYYY-MM-DD), propertyId.
export const GET = safeHandler(async (req: Request) => {
  const p = await authenticateBearer(req);
  if (!p) return unauthorizedJson();
  if (!isStaffRole(p.role)) throw new ApiHttpError(403, "forbidden", "Keine Berechtigung für das Hauptbuch");
  return listResponse(req, async (pg, sp) => {
    await listAccounts(ledgerDb(), p.tenantId); // creates the default chart on first use
    const rows = await trialBalance(ledgerDb(), p.tenantId, { from: dayParam(sp, "from"), to: dayParam(sp, "to"), propertyId: stringParam(sp, "propertyId") });
    return { items: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length };
  });
});
