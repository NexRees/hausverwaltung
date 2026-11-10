// Copyright (c) 2026 NexRees.
// nexrees: general ledger page. Thin host page; logic in src/modules/ledger.
import { getTranslations, getLocale } from "next-intl/server";
import { Download, Pencil, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { money, date } from "@/lib/format";
import { getDateLocale } from "@/lib/date-locale";
import { Pager } from "@/components/pager";
import { CrudDialog } from "@/components/crud-dialog";
import { TextField, SelectField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCOUNT_TYPES, chainHead, listAccounts, listJournal, trialBalance, verifyChain, type LedgerAccount } from "@/modules/ledger/core";
import { ledgerDb, propertyNames } from "@/modules/ledger/havewa";
import { postJournalEntry, saveLedgerAccount, stornoJournalEntry } from "@/modules/ledger/actions";
import { StornoButton } from "@/modules/ledger/ui/storno-button";

const PAGE_SIZE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const selectCls = "flex h-9 rounded-lg border border-input bg-transparent px-3 text-sm dark:bg-input/30";

type T = Awaited<ReturnType<typeof getTranslations>>;

function AccountDialog({ t, account }: { t: T; account?: LedgerAccount }) {
  const edit = !!account;
  return (
    <CrudDialog
      trigger={
        edit ? (
          <Button variant="ghost" size="icon" aria-label={t("ledger.editAccountOf", { number: account!.number })} title={t("ledger.editAccountOf", { number: account!.number })}>
            <Pencil aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus aria-hidden className="size-4" />
            {t("ledger.newAccount")}
          </Button>
        )
      }
      title={edit ? t("ledger.editAccount") : t("ledger.newAccount")}
      description={edit ? `${account!.number} · ${account!.name}` : undefined}
      action={saveLedgerAccount}
      submitLabel={edit ? t("common.save") : t("common.create")}
    >
      {edit && <input type="hidden" name="id" value={account!.id} />}
      <TextField name="number" label={t("ledger.accountNumber")} defaultValue={account?.number} />
      <TextField name="name" label={t("ledger.accountName")} defaultValue={account?.name} />
      {!edit && (
        <SelectField name="type" label={t("ledger.accountType")} options={ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`ledger.type.${x}`) }))} />
      )}
      <TextField name="datevNumber" label={t("ledger.datevNumber")} required={false} defaultValue={account?.datevNumber ?? undefined} />
    </CrudDialog>
  );
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; verify?: string; from?: string; to?: string; property?: string; account?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireRole(["VERWALTER", "BUCHHALTUNG"]);
  const t = await getTranslations();
  const locale = await getLocale();
  const df = await getDateLocale(locale);
  const db = ledgerDb();

  const view = sp.view === "accounts" ? "accounts" : "journal";
  const from = sp.from && DAY.test(sp.from) ? sp.from : "";
  const to = sp.to && DAY.test(sp.to) ? sp.to : "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);

  // Recomputing every hash takes seconds on a large journal, so it runs on request (?verify=1).
  const verify = sp.verify === "1";
  const [accounts, properties, head, chain] = await Promise.all([
    listAccounts(db, user.tenantId),
    prisma.property.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    chainHead(db, user.tenantId),
    verify ? verifyChain(db, user.tenantId) : null,
  ]);
  const propertyId = properties.some((p) => p.id === sp.property) ? sp.property! : "";
  const accountId = accounts.some((a) => a.id === sp.account) ? sp.account! : "";

  const filter = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(propertyId ? { property: propertyId } : {}) };
  const href = (v: string, extra: Record<string, string> = {}) => `/ledger?${new URLSearchParams({ view: v, ...filter, ...extra })}`;
  const accountOptions = accounts.map((a) => ({ value: a.id, label: `${a.number} ${a.name}` }));
  const intact = !chain || chain.firstBadSeq == null;
  const year = (to || from || new Date().toISOString()).slice(0, 4);

  const journal = view === "journal" ? await listJournal(db, user.tenantId, { from, to, propertyId, accountId, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) : null;
  const balances = view === "accounts" ? await trialBalance(db, user.tenantId, { from, to, propertyId }) : null;
  const names = journal ? await propertyNames(user.tenantId, journal.items.map((e) => e.propertyId)) : new Map<string, string>();
  const pages = journal ? Math.max(1, Math.ceil(journal.total / PAGE_SIZE)) : 1;
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("ledger.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ledger.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" render={<a href={`/api/export/datev?year=${year}`} />}>
            <Download aria-hidden className="size-4" />
            {t("ledger.datevExport", { year })}
          </Button>
          <AccountDialog t={t} />
          <CrudDialog
            trigger={
              <Button size="sm">
                <Plus aria-hidden className="size-4" />
                {t("ledger.newEntry")}
              </Button>
            }
            title={t("ledger.newEntry")}
            description={t("ledger.newEntryHint")}
            action={postJournalEntry}
            submitLabel={t("ledger.post")}
          >
            <TextField name="date" type="date" label={t("ledger.date")} defaultValue={new Date().toISOString().slice(0, 10)} />
            <TextField name="text" label={t("ledger.text")} />
            <SelectField name="debitAccountId" label={t("ledger.debitAccount")} leading={[{ value: "", label: "—" }]} options={accountOptions} />
            <SelectField name="creditAccountId" label={t("ledger.creditAccount")} leading={[{ value: "", label: "—" }]} options={accountOptions} />
            <TextField name="amount" type="number" label={t("ledger.amount")} />
            <SelectField
              name="propertyId"
              label={t("ledger.property")}
              leading={[{ value: "", label: t("ledger.noProperty") }]}
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              defaultValue={propertyId}
            />
          </CrudDialog>
        </div>
      </div>

      <div
        role="status"
        data-state={!chain ? "unchecked" : intact ? "intact" : "broken"}
        className={`flex flex-wrap items-start gap-3 rounded-lg border p-4 text-sm ${intact ? "" : "border-destructive text-destructive"}`}
      >
        {intact ? <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {!chain
              ? t("ledger.chainInfo", { count: head.headSeq })
              : intact
                ? t("ledger.chainOk", { count: chain.entries })
                : t("ledger.chainBroken", { seq: chain.firstBadSeq ?? 0 })}
          </p>
          {intact && head.headSeq > 0 && (
            <p className="text-muted-foreground">
              {t("ledger.chainHead", { seq: head.headSeq })} <code className="break-all">{head.headHash}</code>
            </p>
          )}
        </div>
        {!chain && head.headSeq > 0 && (
          <Button size="sm" variant="outline" render={<Link href={href(view, { verify: "1" })} />}>
            {t("ledger.verifyNow")}
          </Button>
        )}
      </div>

      <nav aria-label={t("ledger.views")} className="flex gap-2">
        <Button size="sm" variant={view === "journal" ? "default" : "outline"} render={<Link href={href("journal")} aria-current={view === "journal" ? "page" : undefined} />}>
          {t("ledger.journal")}
        </Button>
        <Button size="sm" variant={view === "accounts" ? "default" : "outline"} render={<Link href={href("accounts")} aria-current={view === "accounts" ? "page" : undefined} />}>
          {t("ledger.balances")}
        </Button>
      </nav>

      <form className="flex flex-wrap items-end gap-3" role="search" aria-label={t("ledger.filter")}>
        <input type="hidden" name="view" value={view} />
        <div className="space-y-1">
          <label htmlFor="lf-from" className="text-xs text-muted-foreground">{t("ledger.from")}</label>
          <input id="lf-from" type="date" name="from" defaultValue={from} className={selectCls} />
        </div>
        <div className="space-y-1">
          <label htmlFor="lf-to" className="text-xs text-muted-foreground">{t("ledger.to")}</label>
          <input id="lf-to" type="date" name="to" defaultValue={to} className={selectCls} />
        </div>
        <div className="space-y-1">
          <label htmlFor="lf-property" className="text-xs text-muted-foreground">{t("ledger.property")}</label>
          <select id="lf-property" name="property" defaultValue={propertyId} className={selectCls}>
            <option value="">{t("common.all")}</option>
            {properties.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        {view === "journal" && (
          <>
            <div className="space-y-1">
              <label htmlFor="lf-account" className="text-xs text-muted-foreground">{t("ledger.account")}</label>
              <select id="lf-account" name="account" defaultValue={accountId} className={selectCls}>
                <option value="">{t("common.all")}</option>
                {accountOptions.map((a) => (<option key={a.value} value={a.value}>{a.label}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="lf-q" className="text-xs text-muted-foreground">{t("ledger.search")}</label>
              <input id="lf-q" type="search" name="q" defaultValue={q} className={selectCls} />
            </div>
          </>
        )}
        <Button type="submit" size="sm" variant="outline">{t("common.search")}</Button>
      </form>

      {journal && (
        <>
          <p role="status" data-total={journal.total} className="text-sm text-muted-foreground">{t("ledger.entryCount", { count: journal.total })}</p>
          <Card>
            <CardContent className="p-0">
              {journal.items.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{t("ledger.empty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("ledger.seq")}</TableHead>
                      <TableHead>{t("ledger.date")}</TableHead>
                      <TableHead>{t("ledger.text")}</TableHead>
                      <TableHead>{t("ledger.debitAccount")}</TableHead>
                      <TableHead>{t("ledger.creditAccount")}</TableHead>
                      <TableHead className="text-right">{t("ledger.amount")}</TableHead>
                      <TableHead>{t("ledger.origin")}</TableHead>
                      <TableHead><span className="sr-only">{t("common.actions")}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journal.items.map((e) => (
                      <TableRow key={e.id} data-item-name={t("ledger.entryName", { seq: e.seq })}>
                        <TableCell className="whitespace-nowrap tabular-nums">{e.seq}</TableCell>
                        <TableCell className="whitespace-nowrap">{date(`${e.date}T00:00:00Z`, df)}</TableCell>
                        <TableCell>
                          <div>{e.text}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {e.propertyId && <span>{names.get(e.propertyId) ?? t("ledger.propertyGone")}</span>}
                            {e.kind === "STORNO" && <Badge variant="secondary">{t("ledger.storno")}</Badge>}
                            {e.reversedById && <Badge variant="outline">{t("ledger.reversed")}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{e.lines.filter((l) => l.debit > 0).map((l) => (<div key={l.position}>{l.accountNumber} {l.accountName}</div>))}</TableCell>
                        <TableCell>{e.lines.filter((l) => l.credit > 0).map((l) => (<div key={l.position}>{l.accountNumber} {l.accountName}</div>))}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{money(e.amount, locale)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{e.sourceTable ? t(`ledger.sourceOf.${e.sourceTable}`) : t("ledger.sourceOf.manual")}</div>
                          <div>{e.userName ?? e.source ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          {!e.sourceTable && e.kind === "BOOKING" && !e.reversedById && (
                            <StornoButton action={stornoJournalEntry} id={e.id} seq={e.seq} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Pager page={page} pages={pages} href={(p) => href("journal", { ...(accountId ? { account: accountId } : {}), ...(q ? { q } : {}), page: String(p) })} />
        </>
      )}

      {balances && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ledger.accountNumber")}</TableHead>
                  <TableHead>{t("ledger.accountName")}</TableHead>
                  <TableHead>{t("ledger.accountType")}</TableHead>
                  {from && <TableHead className="text-right">{t("ledger.opening")}</TableHead>}
                  <TableHead className="text-right">{t("ledger.debit")}</TableHead>
                  <TableHead className="text-right">{t("ledger.credit")}</TableHead>
                  <TableHead className="text-right">{t("ledger.balance")}</TableHead>
                  <TableHead><span className="sr-only">{t("common.actions")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <Link href={href("journal", { account: a.id })} className="underline-offset-2 hover:underline">{a.number}</Link>
                      {a.datevNumber && <div className="text-xs text-muted-foreground">{t("ledger.datevShort", { number: a.datevNumber })}</div>}
                    </TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t(`ledger.type.${a.type}`)}</TableCell>
                    {from && <TableCell className="text-right tabular-nums">{money(a.opening, locale)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{money(a.debit, locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(a.credit, locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(Math.abs(a.closing), locale)} {a.closing === 0 ? "" : a.closing > 0 ? t("ledger.sideDebit") : t("ledger.sideCredit")}
                    </TableCell>
                    <TableCell><AccountDialog t={t} account={a} /></TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={3}>{t("ledger.total")}</TableCell>
                  {from && <TableCell className="text-right tabular-nums">{money(sum(balances.map((a) => a.opening)), locale)}</TableCell>}
                  <TableCell className="text-right tabular-nums">{money(sum(balances.map((a) => a.debit)), locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(sum(balances.map((a) => a.credit)), locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(sum(balances.map((a) => a.closing)), locale)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
