import { getTranslations, getLocale } from "next-intl/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { BankConnectButton, SyncAllButton } from "@/components/bank-sync";
import { Pager } from "@/components/pager";
import { chargeLedgerPage } from "@/server/charge-ledger";
import { SharedOptionsProvider } from "@/components/shared-options";
import { cn } from "@/lib/utils";
import { money, date } from "@/lib/format";
import { getDateLocale } from "@/lib/date-locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Printer } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  AccountDialog,
  GenerateDialog,
  ChargeDialog,
  PaymentDialog,
  MandateDialog,
  CamtDialog,
} from "@/components/finance-dialogs";
import { DeleteButton } from "@/components/delete-button";
import { DunningDialog } from "@/components/dunning-dialog";
import { configuredProviders } from "@/server/letters";
import { PaymentEditDialog } from "@/components/payment-dialog-edit";
import { summarizeTransactions, txnWhere, type TxnFilter } from "@/lib/transactions";
import { deleteCharge, deleteAccount, deleteMandate, deletePayment, seedDefaultAccounts } from "@/server/actions/finances";
import { deleteBankLink } from "@/server/actions/banking";
import { SepaExport, type SepaFile } from "@/components/sepa-export";
import { earliestCollectionDay } from "@/lib/adapters/sepa";

// Finanzen in Reitern (#53), lange Listen seitenweise.
const TABS = ["charges", "payments", "accounts", "mandates", "io"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; lease?: string; year?: string; tab?: string; page?: string } & TxnFilter>;
}) {
  const sp = await searchParams;
  // Such-/Filterkriterien der Transaktionen (#62)
  const txnFilter: TxnFilter = { acc: sp.acc, from: sp.from, to: sp.to, min: sp.min, max: sp.max, dir: sp.dir, q: sp.q };
  const txnFiltered = Object.values(txnFilter).some(Boolean);
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "charges";
  const page = Math.max(1, Number(sp.page) || 1);
  const user = await requireUser();
  const t = await getTranslations();
  const locale = await getLocale();
  const df = await getDateLocale(locale);
  const tenantId = user.tenantId;
  const payWhere = { tenantId, ...txnWhere(txnFilter) };
  const letterProviders = await configuredProviders(tenantId); // Mahnung per Brief (#78)

  const statusFilter = sp.status ?? "";
  const typeFilter = sp.type ?? "";
  const leaseFilter = sp.lease ?? "";
  const yearFilter = sp.year ?? "";
  const now = new Date();
  // nexrees: status, open amount and paging are computed in Postgres (src/server/charge-ledger.ts).
  const ledger = await chargeLedgerPage(
    tenantId,
    { status: statusFilter, type: typeFilter, leaseId: leaseFilter, year: Number(yearFilter) || undefined },
    tab === "charges" ? (page - 1) * PAGE_SIZE : 0,
    tab === "charges" ? PAGE_SIZE : 0,
    now,
  );
  const [pageCharges, accounts, mandates, leases, persons, bankConnector, bankLinks, payments, paymentCount, paymentSums, allDocuments] = await Promise.all([
    prisma.charge.findMany({
      where: { tenantId, id: { in: ledger.rows.map((r) => r.id) } },
      include: {
        lease: { include: { unit: { include: { building: { include: { property: true } } } }, renters: { include: { person: true } } } },
      },
    }),
    prisma.account.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    prisma.sepaMandate.findMany({ where: { tenantId }, include: { person: true }, orderBy: { createdAt: "desc" } }),
    prisma.lease.findMany({
      where: { tenantId },
      select: { id: true, unit: { select: { label: true, building: { select: { property: { select: { name: true } } } } } } },
    }),
    prisma.person.findMany({ where: { tenantId }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }] }),
    prisma.bankConnector.findUnique({ where: { tenantId } }),
    prisma.bankLink.findMany({ where: { tenantId }, include: { account: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    // Kontobewegungen (Zahlungen) inkl. Konto, zugeordneter Sollstellung und Belegen (#23).
    prisma.payment.findMany({
      where: payWhere,
      include: {
        account: { select: { name: true } },
        // Mieter der Sollstellung als Gegenseite für manuell erfasste Zahlungen (#60)
        charge: { select: { type: true, lease: { select: { renters: { select: { person: { select: { firstName: true, lastName: true } } } } } } } },
        documents: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      skip: tab === "payments" ? (page - 1) * PAGE_SIZE : 0,
      take: tab === "payments" ? PAGE_SIZE : 0,
    }),
    prisma.payment.count({ where: payWhere }),
    prisma.payment.groupBy({ by: ["direction"], where: payWhere, _sum: { amount: true } }),
    prisma.document.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
  ]);
  // Ein-/Ausgang/Saldo über alle Kontobewegungen, nicht nur die aktuelle Seite.
  const txnSummary = summarizeTransactions(
    paymentSums.map((g) => ({ direction: g.direction, amount: Number(g._sum.amount ?? 0) })),
  );
  const isAdmin = user.role === "ADMIN";
  const linkByAccount = new Map(bankLinks.map((l) => [l.accountId, l]));

  const chargeById = new Map(pageCharges.map((c) => [c.id, c]));
  const pagedRows = ledger.rows.flatMap((r) => {
    const c = chargeById.get(r.id);
    return c ? [{ c, paid: r.paid, open: r.open, status: r.status, dunLevel: r.dunLevel }] : [];
  });
  const totalOpen = ledger.totalOpen;
  const STATUSES = ["OPEN", "PARTIAL", "PAID", "OVERDUE"];
  const CHARGE_TYPES = ["MIETE", "NEBENKOSTEN", "HAUSGELD", "KAUTION", "SONSTIGES"];
  const years = ledger.years;
  const chargePages = Math.max(1, Math.ceil(ledger.visible / PAGE_SIZE));
  const paymentPages = Math.max(1, Math.ceil(paymentCount / PAGE_SIZE));
  const filters = { status: statusFilter, type: typeFilter, lease: leaseFilter, year: yearFilter };
  const href = (to: Tab, p = 1, keepFilters = false) => {
    const q = new URLSearchParams();
    if (to !== "charges") q.set("tab", to);
    if (keepFilters) for (const [k, v] of Object.entries(to === "payments" ? txnFilter : filters)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `/finances?${qs}` : "/finances";
  };

  const accountOpts = accounts.map((a) => ({ value: a.id, label: a.name }));
  const sepaFiles: SepaFile[] =
    tab === "io"
      ? (await prisma.sepaCollection.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5 })).map((f) => ({
          id: f.id,
          collectionDate: f.collectionDate.toISOString().slice(0, 10),
          count: f.count,
          total: Number(f.total),
          createdByName: f.createdByName,
          cancelled: !!f.cancelledAt,
        }))
      : [];
  const leaseOpts = leases.map((l) => ({
    value: l.id,
    label: `${l.unit.building.property.name} · ${l.unit.label}`,
  }));
  const personOpts = persons.map((p) => ({ value: p.id, label: `${p.lastName}, ${p.firstName}` }));

  const filterCls = "flex h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";
  const statusVariant = (s: string) =>
    s === "PAID" ? "secondary" : s === "OVERDUE" ? "destructive" : "outline";

  return (
    <SharedOptionsProvider lists={{ documents: allDocuments.map((d) => ({ value: d.id, label: d.name })) }}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("finances.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("finances.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GenerateDialog />
          <ChargeDialog leases={leaseOpts} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tb) => (
            <Link
              key={tb}
              href={href(tb)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                tab === tb ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`finances.tab_${tb}`)}
            </Link>
          ))}
        </div>
        <span className="pb-2 text-sm text-muted-foreground">
          {t("finances.totalOpen")}: <span className="font-semibold text-foreground">{money(totalOpen, locale)}</span>
        </span>
      </div>

      {tab === "charges" && (
        <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("finances.openItems")}</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value="charges" />
            <select
              name="status"
              aria-label={t("a11y.filterStatus")}
              defaultValue={statusFilter}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="">{t("finances.allStatus")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`finances.status${s}`)}</option>
              ))}
            </select>
            <select
              name="type"
              aria-label={t("a11y.filterType")}
              defaultValue={typeFilter}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="">{t("finances.allTypes")}</option>
              {CHARGE_TYPES.map((s) => (
                <option key={s} value={s}>{t(`chargeType.${s}`)}</option>
              ))}
            </select>
            <select
              name="lease"
              aria-label={t("a11y.filterLease")}
              defaultValue={leaseFilter}
              className="flex h-8 max-w-48 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="">{t("finances.allLeases")}</option>
              {leaseOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              name="year"
              aria-label={t("a11y.filterYear")}
              defaultValue={yearFilter}
              className="flex h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="">{t("finances.allYears")}</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline">{t("common.search")}</Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {ledger.visible === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("finances.noOpenItems")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finances.period")}</TableHead>
                  <TableHead>{t("fields.type")}</TableHead>
                  <TableHead>{t("leases.unit")}</TableHead>
                  <TableHead className="text-right">{t("fields.amount")}</TableHead>
                  <TableHead className="text-right">{t("finances.open")}</TableHead>
                  <TableHead>{t("finances.due")}</TableHead>
                  <TableHead>{t("leases.status")}</TableHead>
                  <TableHead className="w-32 text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map(({ c, open, status, dunLevel }) => (
                  <TableRow key={c.id}>
                    <TableCell>{date(c.period, df)}</TableCell>
                    <TableCell>{t(`chargeType.${c.type}`)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.lease ? (
                        <div className="flex flex-col">
                          <Link
                            href={`/units/${c.lease.unit.id}`}
                            className="inline-flex min-h-6 items-center font-medium text-foreground hover:underline"
                          >
                            {c.lease.unit.building.property.name} · {c.lease.unit.label}
                          </Link>
                          {c.lease.renters.length > 0 && (
                            <Link href={`/leases/${c.leaseId}`} className="inline-flex min-h-6 items-center text-xs hover:underline">
                              {c.lease.renters.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ")}
                            </Link>
                          )}
                        </div>
                      ) : (
                        t("common.none")
                      )}
                    </TableCell>
                    <TableCell className="text-right">{money(Number(c.amount), locale)}</TableCell>
                    <TableCell className="text-right">{money(Math.max(0, open), locale)}</TableCell>
                    <TableCell>{date(c.dueDate, df)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant={statusVariant(status)}>{t(`finances.status${status}`)}</Badge>
                        {dunLevel > 0 && <Badge variant="outline">M{dunLevel}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <PaymentDialog chargeId={c.id} defaultAmount={Math.max(0, open)} accounts={accountOpts} />
                        {status === "OVERDUE" && dunLevel < 3 && (
                          <DunningDialog
                            chargeId={c.id}
                            renterName={
                              c.lease?.renters[0]
                                ? `${c.lease.renters[0].person.firstName} ${c.lease.renters[0].person.lastName}`
                                : ""
                            }
                            hasEmail={!!c.lease?.renters[0]?.person.email}
                            providers={letterProviders}
                          />
                        )}
                        {dunLevel > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("print.printPdf")}
                            render={<a href={`/api/dunning/${c.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
                          >
                            <Printer className="size-4" />
                          </Button>
                        )}
                        <DeleteButton
                          action={deleteCharge}
                          id={c.id}
                          itemName={[
                            t(`chargeType.${c.type}`),
                            date(c.period, df),
                            c.lease
                              ? `${c.lease.unit.building.property.name} · ${c.lease.unit.label}`
                              : money(Number(c.amount), locale),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pager page={page} pages={chargePages} href={(p) => href("charges", p, true)} />
        </>
      )}
      {tab === "payments" && (
        <>
      {/* Kontobewegungen (#23) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("finances.transactions")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("finances.transIn")}: {money(txnSummary.inTotal, locale)} · {t("finances.transOut")}:{" "}
            {money(txnSummary.outTotal, locale)} · {t("finances.transNet")}: {money(txnSummary.net, locale)}
            {txnFiltered && ` · ${t("finances.txnFound", { count: paymentCount })}`}
          </p>
          {/* Suche & Filter (#62); GET-Formular, Filter stehen in der URL */}
          <form className="flex flex-wrap items-center gap-2 pt-2">
            <input type="hidden" name="tab" value="payments" />
            <input
              name="q"
              defaultValue={txnFilter.q}
              placeholder={t("finances.txnSearch")}
              aria-label={t("finances.txnSearch")}
              className={cn(filterCls, "w-56")}
            />
            <select aria-label={t("finances.account")} name="acc" defaultValue={txnFilter.acc ?? ""} className={cn(filterCls, "max-w-44")}>
              <option value="">{t("finances.allAccounts")}</option>
              {accountOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select aria-label={t("a11y.filterDirection")} name="dir" defaultValue={txnFilter.dir ?? ""} className={filterCls}>
              <option value="">{t("finances.allDirections")}</option>
              <option value="EINGANG">{t("finances.transIn")}</option>
              <option value="AUSGANG">{t("finances.transOut")}</option>
            </select>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="date" name="from" defaultValue={txnFilter.from} aria-label={t("finances.dateFrom")} title={t("finances.dateFrom")} className={filterCls} />
              –
              <input type="date" name="to" defaultValue={txnFilter.to} aria-label={t("finances.dateTo")} title={t("finances.dateTo")} className={filterCls} />
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <input name="min" inputMode="decimal" defaultValue={txnFilter.min} placeholder={t("finances.amountMin")} className={cn(filterCls, "w-24")} />
              –
              <input name="max" inputMode="decimal" defaultValue={txnFilter.max} placeholder={t("finances.amountMax")} className={cn(filterCls, "w-24")} />
            </span>
            <Button type="submit" size="sm" variant="outline">{t("common.search")}</Button>
            {txnFiltered && (
              <Button size="sm" variant="ghost" render={<Link href={href("payments")} />}>
                {t("finances.resetFilters")}
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {paymentCount === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {txnFiltered ? t("finances.noTxnMatch") : t("finances.noTransactions")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.date")}</TableHead>
                  <TableHead>{t("finances.account")}</TableHead>
                  <TableHead>{t("finances.counterparty")}</TableHead>
                  <TableHead>{t("finances.reference")}</TableHead>
                  <TableHead className="text-right">{t("fields.amount")}</TableHead>
                  <TableHead>{t("documents.title")}</TableHead>
                  <TableHead className="w-20 text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{date(p.date, df)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.account?.name ?? t("common.none")}</TableCell>
                    <TableCell className="max-w-56 whitespace-normal break-words">
                      {p.counterparty ||
                        p.charge?.lease?.renters.map((r) => `${r.person.firstName} ${r.person.lastName}`).join(", ") ||
                        "—"}
                      {p.counterpartyIban && (
                        <span className="block font-mono text-xs text-muted-foreground">{p.counterpartyIban}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-[28rem] whitespace-normal break-words text-muted-foreground"
                      title={p.reference || undefined}
                    >
                      {p.reference || (p.charge ? t(`chargeType.${p.charge.type}`) : "")}
                      {p.note ? <span className="mt-0.5 block text-xs italic">{p.note}</span> : null}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${p.direction === "EINGANG" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      {p.direction === "EINGANG" ? "+" : "−"}
                      {money(Number(p.amount), locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.documents.length > 0 ? (
                        <span className="flex flex-col gap-0.5">
                          {p.documents.map((d) => (
                            <a
                              key={d.id}
                              href={`/api/documents/${d.id}`}
                              className="block truncate text-xs leading-6 hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {d.name}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <PaymentEditDialog
                          payment={{ id: p.id, note: p.note, documentIds: p.documents.map((d) => d.id) }}
                          documents="documents"
                        />
                        <DeleteButton
                          action={deletePayment}
                          id={p.id}
                          itemName={[date(p.date, df), money(Number(p.amount), locale), p.counterparty].filter(Boolean).join(" · ")}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pager page={page} pages={paymentPages} href={(p) => href("payments", p, true)} />
        </>
      )}
      {tab === "accounts" && (
        <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t("finances.accounts")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <AccountDialog />
            {bankConnector && <BankConnectButton />}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!bankConnector && (
            <p className="text-xs text-muted-foreground">
              {t("bank.notConfiguredHint")}{" "}
              {isAdmin && (
                <Link href="/settings" className="underline">
                  {t("settings.title")}
                </Link>
              )}
            </p>
          )}
          {accounts.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("finances.noAccounts")}</p>
              <form action={seedDefaultAccounts}>
                <Button type="submit" variant="outline" size="sm">{t("finances.seedAccounts")}</Button>
              </form>
            </div>
          ) : (
            accounts.map((a) => {
              const link = linkByAccount.get(a.id);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground"> · {t(`accountType.${a.type}`)}</span>
                    {link && (
                      <Badge variant="secondary" className="ml-2">
                        {t("bank.linked")}
                      </Badge>
                    )}
                    {a.iban ? <div className="text-xs text-muted-foreground">{a.iban}</div> : null}
                    {link && (
                      <div className="text-xs text-muted-foreground">
                        {link.aspspName} · {link.lastSyncAt ? `${t("bank.lastSync")}: ${date(link.lastSyncAt, df)}` : t("bank.neverSynced")}
                      </div>
                    )}
                  </div>
                  {/* Kontostand laut Bank (#57) */}
                  {a.balance != null && (
                    <div className="ml-auto text-right">
                      <div className={cn("font-semibold", Number(a.balance) < 0 && "text-destructive")}>{money(Number(a.balance), locale)}</div>
                      {a.balanceAt && <div className="text-xs text-muted-foreground">{t("bank.balanceAt", { date: date(a.balanceAt, df) })}</div>}
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <AccountDialog account={{ id: a.id, name: a.name, type: a.type, iban: a.iban }} />
                    {/* Papierkorb: verbundenes Konto → Verbindung trennen, manuelles Konto → löschen (#53) */}
                    {link ? (
                      <DeleteButton action={deleteBankLink} id={link.id} label={t("bank.unlink")} description={t("bank.unlinkDesc")} />
                    ) : (
                      <DeleteButton action={deleteAccount} id={a.id} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
        </>
      )}
      {tab === "mandates" && (
        <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("finances.mandates")}</CardTitle>
            <MandateDialog persons={personOpts} />
          </CardHeader>
          <CardContent className="space-y-2">
            {mandates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("finances.noMandates")}</p>
            ) : (
              mandates.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium">
                      {m.person.firstName} {m.person.lastName}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {m.iban} · {m.mandateRef}
                    </div>
                  </div>
                  <DeleteButton action={deleteMandate} id={m.id} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
        </>
      )}
      {tab === "io" && (
        <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("finances.importExport")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-2">
          {bankLinks.length > 0 && <SyncAllButton />}
            <CamtDialog accounts={accountOpts} />
            <Button size="sm" variant="outline" render={<a href={`/api/export/datev?year=${new Date().getUTCFullYear()}`} />}>
              <Download className="size-4" />
              {t("finances.datevExport")}
            </Button>
            <Button size="sm" variant="outline" render={<a href="/api/export/openitems" />}>
              <Download className="size-4" />
              {t("finances.openItemsCsv")}
            </Button>
            {/* nexrees: SEPA files are created by POST and recorded (no double debit) */}
            <SepaExport earliest={earliestCollectionDay()} files={sepaFiles} />
        </CardContent>
      </Card>
        </>
      )}
    </div>
    </SharedOptionsProvider>
  );
}
