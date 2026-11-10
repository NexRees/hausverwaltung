"use server";

import { invalid } from "@/lib/schemas";

// nexrees: tasks handed between colleagues and comments with @mentions on records.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWriter } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { canSeeEntity, getAccessScope, propertyOf, usersWhoCanSee } from "@/lib/access";
import { COMMENT_MAX, entityPath, isCollabEntity, resolveMentions, type CollabEntity } from "@/lib/collab";
import type { ActionState } from "@/lib/schemas";

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const taskInput = z.object({
  id: z.preprocess(blankToUndef, z.string().optional()),
  title: z.string().trim().min(1).max(200),
  description: z.preprocess(blankToUndef, z.string().trim().max(5000).optional()),
  dueDate: z.preprocess(blankToUndef, z.coerce.date().optional()),
  assigneeId: z.preprocess(blankToUndef, z.string().optional()),
  entity: z.preprocess(blankToUndef, z.string().optional()),
  entityId: z.preprocess(blankToUndef, z.string().optional()),
});

function fail(msg?: string): ActionState {
  return { error: msg ?? "Ungültige Eingabe" };
}

async function staffIds(tenantId: string): Promise<Set<string>> {
  return new Set((await usersWhoCanSee(tenantId)).map((u) => u.id));
}

/** Create or edit a task; notifies the new assignee. */
export async function saveTask(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = taskInput.safeParse(Object.fromEntries(fd));
  if (!r.success) return invalid(r.error);
  const d = r.data;
  const scope = await getAccessScope(user);

  if (d.assigneeId && !(await staffIds(user.tenantId)).has(d.assigneeId)) return fail("Unbekannte Person");

  let link: { entity: CollabEntity; entityId: string; propertyId: string | null } | null = null;
  if (d.entity || d.entityId) {
    if (!isCollabEntity(d.entity) || !d.entityId || !(await canSeeEntity(scope, d.entity, d.entityId))) return fail("Datensatz nicht gefunden");
    link = { entity: d.entity, entityId: d.entityId, propertyId: (await propertyOf(user.tenantId, d.entity, d.entityId)) ?? null };
  }

  const fields = {
    title: d.title,
    description: d.description ?? null,
    dueDate: d.dueDate ?? null,
    assigneeId: d.assigneeId ?? null,
  };

  let taskId: string;
  let previousAssignee: string | null = null;
  if (d.id) {
    const before = await prisma.task.findFirst({ where: { id: d.id, tenantId: user.tenantId }, select: { assigneeId: true } });
    if (!before) return fail("Aufgabe nicht gefunden");
    previousAssignee = before.assigneeId;
    await prisma.task.update({ where: { id: d.id }, data: { ...fields, ...(link ?? {}) } });
    taskId = d.id;
    await audit(user, "UPDATE", "Task", taskId, d.title);
  } else {
    const created = await prisma.task.create({
      data: { ...fields, ...(link ?? {}), tenantId: user.tenantId, createdById: user.id },
    });
    taskId = created.id;
    await audit(user, "CREATE", "Task", taskId, d.title);
  }

  if (fields.assigneeId && fields.assigneeId !== previousAssignee && fields.assigneeId !== user.id) {
    await notifyUsers(user.tenantId, [fields.assigneeId], {
      title: `Neue Aufgabe von ${user.name ?? user.email ?? "Kollegin/Kollege"}: ${d.title}`,
      body: d.dueDate ? `Fällig: ${d.dueDate.toISOString().slice(0, 10)}` : undefined,
      link: "/my-work",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Mark a task done or open again; tells whoever handed it over when it is done. */
export async function setTaskDone(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const done = fd.get("done") === "1";
  const task = await prisma.task.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!task || task.done === done) return;
  await prisma.task.update({ where: { id }, data: { done, doneAt: done ? new Date() : null } });
  await audit(user, "UPDATE", "Task", id, `${done ? "Erledigt" : "Wieder geöffnet"}: ${task.title}`);
  if (done && task.createdById && task.createdById !== user.id) {
    await notifyUsers(user.tenantId, [task.createdById], {
      title: `Erledigt von ${user.name ?? user.email ?? "Kollegin/Kollege"}: ${task.title}`,
      link: task.entity && task.entityId && isCollabEntity(task.entity) ? entityPath(task.entity, task.entityId) : "/my-work",
    });
  }
  revalidatePath("/", "layout");
}

/** Take an unassigned task. Atomic: if two people click at once, only the first gets it. */
export async function takeTask(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const r = await prisma.task.updateMany({ where: { id, tenantId: user.tenantId, assigneeId: null, done: false }, data: { assigneeId: user.id } });
  if (r.count > 0) await audit(user, "UPDATE", "Task", id, "Übernommen");
  revalidatePath("/", "layout");
}

const commentInput = z.object({
  entity: z.string(),
  entityId: z.string().min(1),
  body: z.string().trim().min(1).max(COMMENT_MAX),
});

export async function addComment(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireWriter();
  const r = commentInput.safeParse({ entity: fd.get("entity"), entityId: fd.get("entityId"), body: fd.get("body") });
  if (!r.success) return invalid(r.error);
  const { entity, entityId, body } = r.data;
  if (!isCollabEntity(entity)) return fail();
  const scope = await getAccessScope(user);
  if (!(await canSeeEntity(scope, entity, entityId))) return fail("Datensatz nicht gefunden");

  const candidates = await usersWhoCanSee(user.tenantId, entity, entityId);
  const claimed = fd.getAll("mentions").map(String);
  const mentions = resolveMentions(body, claimed, candidates, user.id);
  const propertyId = (await propertyOf(user.tenantId, entity, entityId)) ?? null;

  await prisma.comment.create({
    data: {
      tenantId: user.tenantId,
      entity,
      entityId,
      propertyId,
      authorId: user.id,
      authorName: user.name ?? user.email ?? "—",
      body,
      mentions,
    },
  });
  if (mentions.length > 0) {
    await notifyUsers(user.tenantId, mentions, {
      title: `${user.name ?? user.email ?? "Jemand"} hat dich erwähnt`,
      body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
      link: entityPath(entity, entityId),
    });
  }
  revalidatePath(entityPath(entity, entityId));
  revalidatePath("/my-work");
  return { ok: true };
}

/** Authors delete their own comments; admins any comment of the tenant. */
export async function deleteComment(fd: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(fd.get("id") ?? "");
  const c = await prisma.comment.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!c || (c.authorId !== user.id && user.role !== "ADMIN")) throw new Error("Nicht erlaubt");
  await prisma.comment.delete({ where: { id } });
  await audit(user, "DELETE", "Comment", id, `Kommentar von ${c.authorName} (${c.entity})`);
  if (isCollabEntity(c.entity)) revalidatePath(entityPath(c.entity, c.entityId));
}
