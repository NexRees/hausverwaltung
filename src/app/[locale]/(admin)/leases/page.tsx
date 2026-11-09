import { getTranslations, getLocale } from "next-intl/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Download } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { money, date } from "@/lib/format";
import { getDateLocale } from "@/lib/date-locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeaseDialog } from "@/components/lease-dialogs";
import { DeleteButton } from "@/components/delete-button";
import { deleteLease } from "@/server/actions/leases";
import { Pager } from "@/components/pager";
import { ListFilter } from "@/components/list-filter";
import { SharedOptionsProvider } from "@/components/shared-options";
import { listParams, listHref, pageCount, icontains } from "@/lib/list-params";

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireUser();
  // nexrees: paged + searchable, option lists shared via SharedOptionsProvider (scale test)
  const lp = listParams(await searchParams);
  const where = {
    tenantId: user.tenantId,
    ...(lp.q
      ? {
          OR: [
            { unit: { label: icontains(lp.q) } },
            { unit: { building: { property: { name: icontains(lp.q) } } } },
            { renters: { some: { person: { lastName: icontains(lp.q) } } } },
            { renters: { some: { person: { firstName: icontains(lp.q) } } } },
          ],
        }
      : {}),
  };
  const t = await getTranslations();
  const locale = await getLocale();
  const df = await getDateLocale(locale);

  const [leases, total, units, persons, customDefs] = await Promise.all([
    prisma.lease.findMany({
      where,
      skip: lp.skip,
      take: lp.take,
      include: {
        unit: { include: { building: { include: { property: true } } } },
        renters: { include: { person: true } },
        components: { select: { amount: true } },
      },
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
    }),
    prisma.lease.count({ where }),
    prisma.unit.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, label: true, building: { select: { name: true, property: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.person.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.customFieldDef.findMany({
      where: { tenantId: user.tenantId, entity: "LEASE" },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
  ]);

  const unitOpts = units.map((u) => ({
    value: u.id,
    label: `${u.building.property.name} · ${u.building.name} · ${u.label}`,
  }));
  const personOpts = persons.map((p) => ({ value: p.id, label: `${p.lastName}, ${p.firstName}` }));

  const now = new Date();
  const statusOf = (l: (typeof leases)[number]) => {
    if (l.startDate > now) return { key: "future", variant: "outline" as const };
    if (l.endDate && l.endDate < now) return { key: "ended", variant: "outline" as const };
    return { key: "active", variant: "secondary" as const };
  };
  const warm = (l: (typeof leases)[number]) =>
    Number(l.rentCold) + l.components.reduce((a, c) => a + Number(c.amount), 0);

  return (
    <SharedOptionsProvider lists={{ units: unitOpts, persons: personOpts }}>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("leases.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("leases.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" render={<a href="/api/export/tenants" />}>
            <Download className="size-4" />
            {t("common.exportCsv")}
          </Button>
          <LeaseDialog units="units" persons="persons" customDefs={customDefs} />
        </div>
      </div>

      <ListFilter q={lp.q} total={total} />

      <Card>
        <CardContent className="p-0">
          {leases.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("leases.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("leases.unit")}</TableHead>
                  <TableHead>{t("leases.tenant")}</TableHead>
                  <TableHead className="text-right">{t("leases.coldRent")}</TableHead>
                  <TableHead className="text-right">{t("leases.warmRent")}</TableHead>
                  <TableHead>{t("leases.start")}</TableHead>
                  <TableHead>{t("leases.status")}</TableHead>
                  <TableHead className="w-24 text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((l) => {
                  const st = statusOf(l);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        <Link href={`/leases/${l.id}`} className="hover:underline">
                          {l.unit.building.property.name} · {l.unit.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.renters.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ") ||
                          t("common.none")}
                      </TableCell>
                      <TableCell className="text-right">{money(Number(l.rentCold), locale)}</TableCell>
                      <TableCell className="text-right">{money(warm(l), locale)}</TableCell>
                      <TableCell>{date(l.startDate, df)}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{t(`leases.${st.key}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <LeaseDialog
                            units="units"
                            customDefs={customDefs}
                            lease={{
                              id: l.id,
                              unitId: l.unitId,
                              startDate: l.startDate,
                              endDate: l.endDate,
                              rentCold: String(l.rentCold),
                              personCount: l.personCount,
                              noticePeriodM: l.noticePeriodM,
                              custom: (l.custom as Record<string, string>) ?? {},
                            }}
                          />
                          <DeleteButton action={deleteLease} id={l.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pager page={lp.page} pages={pageCount(total)} href={(p) => listHref("/leases", { q: lp.q }, p)} />
    </div>
    </SharedOptionsProvider>
  );
}
