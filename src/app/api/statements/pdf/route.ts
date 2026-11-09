import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { actingTenantId } from "@/lib/acting-tenant";
import { roleAllows, WRITE_ROLES } from "@/lib/rbac";
import { computeStatement } from "@/server/statements";
import { statementPdfFor } from "@/server/statement-letter";

// nexrees: Betriebskostenabrechnung eines Mietverhältnisses als PDF (Vorschau/Download).
// ?propertyId=…&year=…&key=<leaseId>
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!roleAllows(session.user.role, WRITE_ROLES)) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const propertyId = sp.get("propertyId") ?? "";
  const year = Number(sp.get("year"));
  const key = sp.get("key") ?? "";
  if (!propertyId || !Number.isInteger(year) || !key) return new Response("Bad request", { status: 400 });

  const tenantId = await actingTenantId(session.user);
  const st = await computeStatement(tenantId, propertyId, year);
  const u = st.units.find((x) => x.key === key && x.leaseId);
  if (!st.property || !u) return new Response("Not found", { status: 404 });

  const pdf = await statementPdfFor(tenantId, st, u, year);
  const name = `Abrechnung ${year} - ${u.label}.pdf`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
