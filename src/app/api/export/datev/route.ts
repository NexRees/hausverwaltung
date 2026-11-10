import { auth } from "@/auth";
import { actingTenantId } from "@/lib/acting-tenant";
import { roleAllows } from "@/lib/rbac";
import { toDatevExtf } from "@/lib/adapters/datev";
import { datevBookings } from "@/modules/ledger/core";
import { ledgerDb } from "@/modules/ledger/havewa";

// nexrees: the Buchungsstapel comes from the general ledger (src/modules/ledger): one row per
// journal entry with its real debit and credit account (the account's DATEV number when set),
// for one calendar year (?year=YYYY, default: current year). Upstream exported every payment
// against the fixed accounts 1200/8000. Storno entries are exported as their own rows; the
// entry number is Belegfeld 1.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!roleAllows(session.user.role, ["VERWALTER", "BUCHHALTUNG"]))
    return new Response("Forbidden", { status: 403 });

  const now = new Date();
  const raw = new URL(req.url).searchParams.get("year");
  const year = raw == null ? now.getUTCFullYear() : Number(raw);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return new Response("year: YYYY", { status: 400 });

  const { rows, skipped } = await datevBookings(ledgerDb(), await actingTenantId(session.user), year);
  const extf = toDatevExtf(rows, {
    wjBeginn: new Date(Date.UTC(year, 0, 1)),
    datumVon: new Date(Date.UTC(year, 0, 1)),
    datumBis: new Date(Date.UTC(year, 11, 31)),
    bezeichnung: `Buchungsstapel ${year}`,
    now,
  });

  // DATEV erwartet Windows-1252 (ANSI), nicht UTF-8.
  const buf = Buffer.from(extf, "latin1");
  return new Response(buf, {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="EXTF_Buchungsstapel_${year}.csv"`,
      // entries with several lines on both sides cannot be one Buchungsstapel row
      "X-Skipped-Entries": String(skipped.length),
    },
  });
}
