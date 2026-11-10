import { getTranslations, getLocale } from "next-intl/server";
import { AlertCircle, Plus } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { money, date, decimal, intlLocale } from "@/lib/format";
import { getDateLocale } from "@/lib/date-locale";
import { openChargesForLeases } from "@/server/charge-ledger";
import { splitOpenItems } from "@/lib/portal-open-items";
import { companyContact } from "@/lib/portal-contact";
import { BRAND } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CrudDialog } from "@/components/crud-dialog";
import { TextField, TextAreaField } from "@/components/form-fields";
import { reportIssue } from "@/server/actions/portal";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function PortalPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const locale = await getLocale();
  const df = await getDateLocale(locale);
  // nexrees: billing month as "Juli 2026" (periods are stored as the 1st of the month, UTC).
  const monthFmt = new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" });
  const month = (d: Date) => monthFmt.format(d);

  const [dbUser, company] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { personId: true } }),
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, address: true, phone: true, smtpFrom: true } }),
  ]);
  const personId = dbUser?.personId ?? "__none__";
  const companyName = company?.name ?? BRAND.name;
  const contact = companyContact(company ?? {});

  const [renters, owners] = await Promise.all([
    prisma.renter.findMany({
      where: { tenantId: user.tenantId, personId },
      include: {
        lease: {
          include: {
            unit: { include: { building: { include: { property: true } } } },
            components: true,
          },
        },
      },
    }),
    prisma.owner.findMany({
      where: { tenantId: user.tenantId, personId },
      include: { unit: { include: { building: { include: { property: true } } } } },
    }),
  ]);

  const propertyIds = Array.from(
    new Set([
      ...renters.map((r) => r.lease.unit.building.propertyId),
      ...owners.map((o) => o.unit.building.propertyId),
    ]),
  );
  const leaseIds = Array.from(new Set(renters.map((r) => r.leaseId)));
  const now = new Date();
  const since = new Date(now);
  since.setUTCFullYear(since.getUTCFullYear() - 1);

  const [resolutions, documents, openCharges, payments] = await Promise.all([
    propertyIds.length
      ? prisma.resolution.findMany({
          where: { tenantId: user.tenantId, propertyId: { in: propertyIds } },
          orderBy: { number: "asc" },
          include: { subcommunity: { select: { name: true } } },
        })
      : Promise.resolve([]),
    // Datenschutz: nur ausdrücklich dieser Person zugeordnete Dokumente. Objekt-/
    // Wohnungs-Dokumente ohne Personenbezug (Steuer, Versicherung, Kauf …) bleiben
    // intern und werden im Portal nicht angezeigt.
    dbUser?.personId
      ? prisma.document.findMany({ where: { tenantId: user.tenantId, personId: dbUser.personId }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    // nexrees: open amounts computed in Postgres (charge-ledger), split into due and due soon.
    openChargesForLeases(user.tenantId, leaseIds, now),
    // Zahlungsverlauf: NUR tatsächlich erfasste Zahlungen (nicht offene Posten,
    // die stehen bereits unter „Offene Posten") — #37. nexrees: last 12 months.
    leaseIds.length
      ? prisma.payment.findMany({
          where: { tenantId: user.tenantId, charge: { leaseId: { in: leaseIds } }, date: { gte: since } },
          select: { id: true, date: true, amount: true, charge: { select: { type: true, period: true } } },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const myTickets = await prisma.ticket.findMany({
    where: { tenantId: user.tenantId, reporterId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const open = splitOpenItems(openCharges, now);
  const assigned = renters.length > 0 || owners.length > 0;
  // Only tenants and owners wait for a flat; contractors and staff never get one.
  const needsAssignment = !assigned && (user.role === "MIETER" || user.role === "EIGENTUEMER");

  const warm = (l: (typeof renters)[number]["lease"]) =>
    Number(l.rentCold) + l.components.reduce((a, c) => a + Number(c.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("portal.welcome")}, {user.name}
        </h1>
        <p className="text-sm text-muted-foreground">{t(`userRole.${user.role}`)}</p>
      </div>

      {/* nexrees: an account without lease or ownership gets an explanation instead of an empty page */}
      {needsAssignment && (
        <Card className="ring-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">{t("portal.unassignedTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{t("portal.unassigned", { company: companyName })}</p>
          </CardContent>
        </Card>
      )}

      {/* Mieter: Mietverhältnisse */}
      {renters.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t("portal.myLeases")}</CardTitle>
            <CrudDialog
              trigger={
                <Button size="sm">
                  <Plus className="size-4" />
                  {t("portal.report")}
                </Button>
              }
              title={t("portal.report")}
              action={reportIssue}
              submitLabel={t("common.create")}
            >
              <TextField name="title" label={t("portal.issueTitle")} />
              <TextAreaField name="description" label={t("rentComponent.note")} />
            </CrudDialog>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {renters.map((r) => (
                <li key={r.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="font-medium">
                    {r.lease.unit.building.property.name} · {r.lease.unit.label}
                  </div>
                  <div className="text-muted-foreground">
                    {t("leases.warmRent")}: {money(warm(r.lease), locale)} · {t("leases.start")}: {date(r.lease.startDate, df)}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Mieter: eigene Schadensmeldungen + Status */}
      {myTickets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.myTickets")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {myTickets.map((tk) => (
                <li key={tk.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{tk.title}</div>
                    <div className="text-xs text-muted-foreground">{date(tk.createdAt, df)}</div>
                  </div>
                  <Badge variant={tk.status === "ERLEDIGT" ? "secondary" : "outline"}>
                    {t(`ticketStatus.${tk.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Mieter: offene Posten (nexrees: due/overdue vs. due soon, with due dates and totals) */}
      {renters.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-1 space-y-0">
            <CardTitle className="text-base">{t("portal.myOpenItems")}</CardTitle>
            {open.total > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t("portal.openTotal")}: </span>
                <span className="font-semibold tabular-nums">{money(open.total, locale)}</span>
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {open.total <= 0 ? (
              <p className="text-sm text-muted-foreground">{t("portal.noOpenItems")}</p>
            ) : (
              <>
                {open.due.length > 0 && (
                  <section aria-labelledby="open-due">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h3 id="open-due" className="text-sm font-medium">{t("portal.dueNow")}</h3>
                      <span className="text-sm font-semibold tabular-nums">{money(open.dueTotal, locale)}</span>
                    </div>
                    <ul className="divide-y rounded-md border">
                      {open.due.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {t(`chargeType.${c.type}`)} · {month(c.period)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("portal.dueOn", { date: date(c.dueDate, df) })}
                              {c.paid > 0 && <> · {t("portal.partlyPaid", { amount: money(c.paid, locale) })}</>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.overdue ? (
                              <Badge variant="destructive" className="text-red-800 dark:text-red-200">
                                <AlertCircle aria-hidden />
                                {t("portal.overdueSince", { date: date(new Date(c.dueDate.getTime() + DAY_MS), df) })}
                              </Badge>
                            ) : (
                              <Badge variant="outline">{t("portal.dueToday")}</Badge>
                            )}
                            <span className="font-medium tabular-nums">{money(c.open, locale)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {open.upcoming.length > 0 && (
                  <section aria-labelledby="open-upcoming">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h3 id="open-upcoming" className="text-sm font-medium">{t("portal.dueSoon")}</h3>
                      <span className="text-sm font-semibold tabular-nums">{money(open.upcomingTotal, locale)}</span>
                    </div>
                    <ul className="divide-y rounded-md border">
                      {open.upcoming.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {t(`chargeType.${c.type}`)} · {month(c.period)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("portal.dueOn", { date: date(c.dueDate, df) })}
                              {c.paid > 0 && <> · {t("portal.partlyPaid", { amount: money(c.paid, locale) })}</>}
                            </div>
                          </div>
                          <span className="font-medium tabular-nums">{money(c.open, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Mieter: Zahlungsverlauf (nexrees: last 12 months, as a table) */}
      {renters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle id="payment-history" className="text-base">{t("portal.paymentHistory")}</CardTitle>
            <CardDescription>{t("portal.paymentsPeriod")}</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("portal.noPayments")}</p>
            ) : (
              <table aria-labelledby="payment-history" className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">{t("portal.colDate")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("portal.colType")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("portal.colAmount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 tabular-nums">{date(p.date, df)}</td>
                      <td className="py-2 pr-3">
                        {p.charge ? `${t(`chargeType.${p.charge.type}`)} · ${month(p.charge.period)}` : "—"}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">{money(Number(p.amount), locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Eigentümer: Eigentum */}
      {owners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.myUnits")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {owners.map((o) => (
                <li key={o.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="font-medium">
                    {o.unit.building.property.name} · {o.unit.label}
                  </div>
                  <div className="text-muted-foreground">
                    MEA {decimal(o.unit.mea, locale)} · {t("weg.share")}: {decimal(o.share, locale)}‰
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Eigentümer: Beschlüsse */}
      {owners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.resolutions")}</CardTitle>
          </CardHeader>
          <CardContent>
            {resolutions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("portal.noResolutions")}</p>
            ) : (
              <ul className="space-y-2">
                {resolutions.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      #{r.number} · {r.title}
                      {r.subcommunity && ` (${r.subcommunity.name})`}
                    </span>
                    <Badge variant={r.result === "ANGENOMMEN" ? "secondary" : "outline"}>
                      {t(`resolutionResult.${r.result}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dokumente */}
      {(assigned || documents.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("portal.myDocuments")}</CardTitle>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("portal.noDocuments")}</p>
            ) : (
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id}>
                    <a
                      href={`/api/documents/${d.id}`}
                      className="flex justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span>{d.name}</span>
                      <span className="text-muted-foreground">{t(`documentCategory.${d.category}`)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* nexrees: who manages the home and how to reach them */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("portal.contact")}</CardTitle>
        </CardHeader>
        <CardContent>
          <address className="space-y-1 text-sm not-italic">
            <div className="font-medium">{companyName}</div>
            {contact.addressLines.length > 0 && (
              <div>
                {contact.addressLines.map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))}
              </div>
            )}
            {contact.phone && (
              <div>
                {t("portal.phone")}:{" "}
                {contact.phoneHref ? (
                  <a href={contact.phoneHref} className="inline-flex min-h-6 items-center underline underline-offset-2">
                    {contact.phone}
                  </a>
                ) : (
                  contact.phone
                )}
              </div>
            )}
            {contact.email && (
              <div>
                {t("portal.email")}:{" "}
                <a href={`mailto:${contact.email}`} className="inline-flex min-h-6 items-center break-all underline underline-offset-2">
                  {contact.email}
                </a>
              </div>
            )}
            {!contact.phone && !contact.email && contact.addressLines.length === 0 && (
              <p className="text-muted-foreground">{t("portal.noContact")}</p>
            )}
          </address>
        </CardContent>
      </Card>
    </div>
  );
}
