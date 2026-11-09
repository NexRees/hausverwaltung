import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
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
import { UnitDialog } from "@/components/entity-dialogs";
import { LeaseDialog } from "@/components/lease-dialogs";
import { ImportDialog } from "@/components/import-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteUnit } from "@/server/actions/objects";
import { Pager } from "@/components/pager";
import { ListFilter } from "@/components/list-filter";
import { SharedOptionsProvider } from "@/components/shared-options";
import { listParams, listHref, pageCount, icontains } from "@/lib/list-params";

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireUser();
  const t = await getTranslations();
  // nexrees: paged + searchable, option lists shared via SharedOptionsProvider (scale test)
  const lp = listParams(await searchParams);
  const where = {
    tenantId: user.tenantId,
    ...(lp.q
      ? {
          OR: [
            { label: icontains(lp.q) },
            { building: { name: icontains(lp.q) } },
            { building: { property: { name: icontains(lp.q) } } },
            { leases: { some: { renters: { some: { person: { lastName: icontains(lp.q) } } } } } },
          ],
        }
      : {}),
  };

  const [units, total, customDefs, leaseDefs, persons, properties] = await Promise.all([
    prisma.unit.findMany({
      where,
      skip: lp.skip,
      take: lp.take,
      include: {
        building: { include: { property: true } },
        leases: {
          select: {
            startDate: true,
            endDate: true,
            renters: { include: { person: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.unit.count({ where }),
    prisma.customFieldDef.findMany({
      where: { tenantId: user.tenantId, entity: "UNIT" },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
    prisma.customFieldDef.findMany({
      where: { tenantId: user.tenantId, entity: "LEASE" },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
    prisma.person.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.property.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, buildings: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } },
    }),
  ]);
  // Auswahl für „Neue Einheit“: jedes Gebäude; Objekte ohne Gebäude bekommen beim Anlegen das Standardgebäude.
  const buildingOpts = properties.flatMap((p) =>
    p.buildings.length
      ? p.buildings.map((b) => ({ value: b.id, label: `${p.name} · ${b.name}` }))
      : [{ value: `property:${p.id}`, label: `${p.name} · ${t("buildings.defaultName")}` }],
  );
  const importPresets = (
    await prisma.importPreset.findMany({ where: { tenantId: user.tenantId, entity: "unit" }, orderBy: { createdAt: "asc" } })
  ).map((p) => ({ id: p.id, name: p.name, mapping: p.mapping as Record<string, number> }));

  const personOpts = persons.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName}` }));
  const now = new Date();
  type LeaseRow = {
    startDate: Date;
    endDate: Date | null;
    renters: { person: { firstName: string; lastName: string } }[];
  };
  const activeLease = (leases: LeaseRow[]) =>
    leases.find((l) => l.startDate <= now && (!l.endDate || l.endDate >= now));
  const occupied = (leases: LeaseRow[]) => !!activeLease(leases);
  const tenantNames = (leases: LeaseRow[]) => {
    const l = activeLease(leases);
    return l ? l.renters.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ") : "";
  };

  return (
    <SharedOptionsProvider lists={{ persons: personOpts }}>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("units.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("units.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<a href="/api/export/units" />}>
            {t("common.exportCsv")}
          </Button>
          <ImportDialog entity="unit" presets={importPresets} />
          {buildingOpts.length > 0 && <UnitDialog buildings={buildingOpts} customDefs={customDefs} />}
        </div>
      </div>

      <ListFilter q={lp.q} total={total} />

      <Card>
        <CardContent className="p-0">
          {units.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("units.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.label")}</TableHead>
                  <TableHead>{t("fields.type")}</TableHead>
                  <TableHead>{t("units.property")}</TableHead>
                  <TableHead>{t("units.building")}</TableHead>
                  <TableHead className="text-right">{t("fields.area")}</TableHead>
                  <TableHead>{t("units.status")}</TableHead>
                  <TableHead>{t("units.tenant")}</TableHead>
                  <TableHead className="w-24 text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <Link href={`/units/${u.id}`} className="hover:underline">
                        {u.label}
                      </Link>
                    </TableCell>
                    <TableCell>{t(`unitType.${u.type}`)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.building.property.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.building.name}</TableCell>
                    <TableCell className="text-right">{String(u.area)}</TableCell>
                    <TableCell>
                      {occupied(u.leases) ? (
                        <Badge variant="secondary">{t("units.occupied")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("units.vacant")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tenantNames(u.leases) || <span className="text-xs">{t("common.none")}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {!occupied(u.leases) && (
                          <LeaseDialog
                            presetUnitId={u.id}
                            persons="persons"
                            customDefs={leaseDefs}
                            triggerLabel={t("units.assignTenant")}
                          />
                        )}
                        <UnitDialog
                          buildingId={u.buildingId}
                          customDefs={customDefs}
                          unit={{
                            id: u.id,
                            label: u.label,
                            type: u.type,
                            area: String(u.area),
                            rooms: u.rooms ? String(u.rooms) : undefined,
                            mea: u.mea != null ? String(u.mea) : undefined,
                            custom: (u.custom as Record<string, string>) ?? {},
                          }}
                        />
                        <DeleteButton action={deleteUnit} id={u.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pager page={lp.page} pages={pageCount(total)} href={(p) => listHref("/units", { q: lp.q }, p)} />
    </div>
    </SharedOptionsProvider>
  );
}
