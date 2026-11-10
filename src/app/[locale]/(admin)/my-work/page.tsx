// nexrees: one page with everything that waits on me: my tasks and tickets, mentions,
// work I handed to others, and unassigned tasks anyone can take.
import { AtSign, Check, Hand, Pencil, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { usersWhoCanSee } from "@/lib/access";
import { byUrgency, entityPath, isCollabEntity } from "@/lib/collab";
import { intlLocale, APP_TIME_ZONE } from "@/lib/format";
import { recordLabels } from "@/server/collab-labels";
import { setTaskDone, takeTask } from "@/server/actions/collab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskDialog } from "@/components/task-dialog";

const MENTION_DAYS = 30;
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function MyWorkPage() {
  const user = await requireWriter();
  const t = await getTranslations();
  const locale = intlLocale(await getLocale());
  const tenantId = user.tenantId;
  const now = new Date();
  const taskInclude = { assignee: { select: { name: true } }, createdBy: { select: { name: true } } } as const;
  const urgent = [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] as const;

  const [users, mine, tickets, mentions, delegated, unassigned] = await Promise.all([
    usersWhoCanSee(tenantId),
    prisma.task.findMany({ where: { tenantId, assigneeId: user.id, done: false }, include: taskInclude, orderBy: [...urgent], take: 200 }),
    prisma.ticket.findMany({
      where: { tenantId, assigneeId: user.id, status: { not: "ERLEDIGT" } },
      select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true, property: { select: { name: true } } },
      orderBy: [...urgent],
      take: 200,
    }),
    prisma.comment.findMany({
      where: { tenantId, mentions: { has: user.id }, createdAt: { gte: new Date(now.getTime() - MENTION_DAYS * 864e5) } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: { tenantId, createdById: user.id, done: false, assigneeId: { not: null }, NOT: { assigneeId: user.id } },
      include: taskInclude,
      orderBy: [...urgent],
      take: 100,
    }),
    prisma.task.findMany({ where: { tenantId, assigneeId: null, done: false }, include: taskInclude, orderBy: [...urgent], take: 50 }),
  ]);
  mine.sort(byUrgency);
  tickets.sort(byUrgency);
  delegated.sort(byUrgency);
  unassigned.sort(byUrgency);

  const labels = await recordLabels(tenantId, [...mine, ...delegated, ...unassigned, ...mentions]);
  const d = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const dt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  type Row = (typeof mine)[number];
  const recordLink = (r: { entity: string | null; entityId: string | null }) => {
    if (!isCollabEntity(r.entity) || !r.entityId) return null;
    const label = labels.get(`${r.entity}:${r.entityId}`);
    if (!label) return null;
    return (
      <Link href={entityPath(r.entity, r.entityId)} className="hover:underline">
        {label}
      </Link>
    );
  };
  const due = (date: Date | null) =>
    date ? <span className={date < now ? "font-medium text-destructive" : undefined}>{d.format(date)}</span> : null;

  const taskRow = (x: Row, opts: { done?: boolean; take?: boolean; who?: "assignee" | "creator" }) => (
    <li key={x.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0 space-y-0.5">
        <div className="truncate font-medium">{x.title}</div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {due(x.dueDate)}
          {recordLink(x)}
          {opts.who === "assignee" && <span>{t("collab.assignedTo", { name: x.assignee?.name ?? "—" })}</span>}
          {opts.who === "creator" && x.createdBy && x.createdById !== user.id && <span>{t("collab.from", { name: x.createdBy.name })}</span>}
        </div>
        {x.description && <p className="line-clamp-2 text-xs text-muted-foreground">{x.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {opts.take && (
          <form action={takeTask}>
            <input type="hidden" name="id" value={x.id} />
            <Button type="submit" variant="outline" size="sm">
              <Hand className="size-4" />
              {t("collab.take")}
            </Button>
          </form>
        )}
        <TaskDialog
          trigger={<Button variant="ghost" size="icon" aria-label={t("collab.editTask")}><Pencil className="size-4" /></Button>}
          users={users}
          task={{ id: x.id, title: x.title, description: x.description, dueDate: isoDay(x.dueDate), assigneeId: x.assigneeId }}
        />
        {opts.done && (
          <form action={setTaskDone}>
            <input type="hidden" name="id" value={x.id} />
            <input type="hidden" name="done" value="1" />
            <Button type="submit" variant="ghost" size="icon" aria-label={t("collab.markDone")} title={t("collab.markDone")}>
              <Check className="size-4" />
            </Button>
          </form>
        )}
      </div>
    </li>
  );

  const empty = (key: string) => <p className="text-sm text-muted-foreground">{t(key)}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("myWork.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("myWork.subtitle")}</p>
        </div>
        <TaskDialog trigger={<Button size="sm"><Plus className="size-4" />{t("collab.newTask")}</Button>} users={users} defaultAssigneeId={user.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("myWork.myTasks")} <Badge variant="secondary">{mine.length}</Badge></CardTitle>
          </CardHeader>
          <CardContent>
            {mine.length === 0 ? empty("myWork.noTasks") : <ul className="space-y-2">{mine.map((x) => taskRow(x, { done: true, who: "creator" }))}</ul>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("myWork.myTickets")} <Badge variant="secondary">{tickets.length}</Badge></CardTitle>
          </CardHeader>
          <CardContent>
            {tickets.length === 0 ? (
              empty("myWork.noTickets")
            ) : (
              <ul className="space-y-2">
                {tickets.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0 space-y-0.5">
                      <Link href={`/tickets?q=${encodeURIComponent(x.title)}`} className="block truncate font-medium hover:underline">{x.title}</Link>
                      <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        {due(x.dueDate)}
                        {x.property && <span>{x.property.name}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Badge variant={x.priority === "HOCH" ? "destructive" : "outline"}>{t(`ticketPriority.${x.priority}`)}</Badge>
                      <Badge variant="secondary">{t(`ticketStatus.${x.status}`)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("myWork.mentions")}</CardTitle>
          </CardHeader>
          <CardContent>
            {mentions.length === 0 ? (
              empty("myWork.noMentions")
            ) : (
              <ul className="space-y-2">
                {mentions.map((c) => (
                  <li key={c.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <AtSign className="size-3.5" />
                      <span className="font-medium text-foreground">{c.authorName}</span>
                      {recordLink(c)}
                      <span>· {dt.format(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("myWork.delegated")} <Badge variant="secondary">{delegated.length}</Badge></CardTitle>
          </CardHeader>
          <CardContent>
            {delegated.length === 0 ? empty("myWork.noDelegated") : <ul className="space-y-2">{delegated.map((x) => taskRow(x, { who: "assignee" }))}</ul>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("myWork.unassigned")} <Badge variant="secondary">{unassigned.length}</Badge></CardTitle>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 ? empty("myWork.noUnassigned") : <ul className="space-y-2">{unassigned.map((x) => taskRow(x, { take: true, done: true, who: "creator" }))}</ul>}
        </CardContent>
      </Card>
    </div>
  );
}
