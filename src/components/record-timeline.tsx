// nexrees: tasks, comments and change history of one record, in one card.
import { Check, MessageSquare, Pencil, Plus, RotateCcw, ScrollText, ListTodo } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/rbac";
import { getAccessScope, canSeeEntity, usersWhoCanSee } from "@/lib/access";
import { byUrgency, mergeTimeline, splitMentions, type CollabEntity, type TimelineItem } from "@/lib/collab";
import { intlLocale } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import { CommentComposer } from "@/components/comment-composer";
import { TaskDialog } from "@/components/task-dialog";
import { deleteComment, setTaskDone } from "@/server/actions/collab";

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function RecordTimeline({ user, entity, entityId }: { user: SessionUser; entity: CollabEntity; entityId: string }) {
  const scope = await getAccessScope(user);
  if (!(await canSeeEntity(scope, entity, entityId))) return null; // portal and board roles see nothing here

  const t = await getTranslations();
  const locale = intlLocale(await getLocale());
  const where = { tenantId: user.tenantId, entity, entityId };
  const [users, tasks, comments, audits] = await Promise.all([
    usersWhoCanSee(user.tenantId, entity, entityId),
    prisma.task.findMany({
      where,
      include: { assignee: { select: { name: true } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.comment.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const now = new Date();
  const openTasks = tasks.filter((x) => !x.done).sort(byUrgency);
  const names = users.map((u) => u.name);
  const dt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const d = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const items = mergeTimeline([
    ...comments.map<TimelineItem>((c) => ({ kind: "comment", at: c.createdAt, id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body, mentions: c.mentions })),
    ...audits.map<TimelineItem>((a) => ({ kind: "audit", at: a.createdAt, id: a.id, userName: a.userName, action: a.action, summary: a.summary })),
    ...tasks.map<TimelineItem>((x) => ({
      kind: "task", at: x.doneAt ?? x.createdAt, id: x.id, title: x.title, done: x.done, doneAt: x.doneAt,
      assigneeName: x.assignee?.name ?? null, createdByName: x.createdBy?.name ?? null,
    })),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("collab.title")}</CardTitle>
        <TaskDialog
          trigger={<Button size="sm" variant="outline"><Plus className="size-4" />{t("collab.newTask")}</Button>}
          users={users}
          entity={entity}
          entityId={entityId}
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {openTasks.length > 0 && (
          <ul className="space-y-2">
            {openTasks.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{x.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {x.assignee?.name ?? t("collab.unassigned")}
                    {x.dueDate && (
                      <span className={x.dueDate < now ? "text-destructive" : undefined}> · {d.format(x.dueDate)}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <TaskDialog
                    trigger={<Button variant="ghost" size="icon" aria-label={t("collab.editTask")}><Pencil className="size-4" /></Button>}
                    users={users}
                    task={{ id: x.id, title: x.title, description: x.description, dueDate: isoDay(x.dueDate), assigneeId: x.assigneeId }}
                  />
                  <form action={setTaskDone}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="done" value="1" />
                    <Button type="submit" variant="ghost" size="icon" aria-label={t("collab.markDone")} title={t("collab.markDone")}>
                      <Check className="size-4" />
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <CommentComposer entity={entity} entityId={entityId} users={users.filter((u) => u.id !== user.id)} />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("collab.empty")}</p>
        ) : (
          <ol className="space-y-3 border-l pl-4">
            {items.map((it) => (
              <li key={`${it.kind}-${it.id}`} className="relative text-sm">
                <span className="absolute -left-[1.4rem] top-0.5 flex size-4 items-center justify-center rounded-full bg-background text-muted-foreground">
                  {it.kind === "comment" ? <MessageSquare className="size-3.5" /> : it.kind === "task" ? <ListTodo className="size-3.5" /> : <ScrollText className="size-3.5" />}
                </span>
                {it.kind === "comment" && (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{it.authorName} <span className="font-normal text-xs text-muted-foreground">· {dt.format(it.at)}</span></span>
                      {(it.authorId === user.id || user.role === "ADMIN") && <DeleteButton action={deleteComment} id={it.id} />}
                    </div>
                    <p className="whitespace-pre-wrap break-words">
                      {splitMentions(it.body, names).map((s, i) =>
                        s.mention ? <span key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">{s.text}</span> : <span key={i}>{s.text}</span>,
                      )}
                    </p>
                  </div>
                )}
                {it.kind === "task" && (
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {it.done
                        ? t("collab.taskDone", { title: it.title, name: it.assigneeName ?? "—" })
                        : t("collab.taskCreated", { title: it.title, by: it.createdByName ?? "—", to: it.assigneeName ?? t("collab.unassigned") })}
                      <span className="text-xs text-muted-foreground"> · {dt.format(it.at)}</span>
                    </span>
                    {it.done && (
                      <form action={setTaskDone}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="done" value="0" />
                        <Button type="submit" variant="ghost" size="icon" aria-label={t("collab.reopen")} title={t("collab.reopen")}>
                          <RotateCcw className="size-4" />
                        </Button>
                      </form>
                    )}
                  </div>
                )}
                {it.kind === "audit" && (
                  <div className="text-muted-foreground">
                    <Badge variant="secondary" className="mr-1">{t(`auditAction.${it.action}`)}</Badge>
                    {it.userName ?? "—"}{it.summary ? `: ${it.summary}` : ""}
                    <span className="text-xs"> · {dt.format(it.at)}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
