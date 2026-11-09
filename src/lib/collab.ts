// nexrees: collaboration helpers (tasks handed between colleagues, comments with @mentions).
// Pure functions only, so they are unit-tested without a database.
import type { UserRole } from "@prisma/client";

/** Records that can carry tasks and comments. Same names as AuditLog.entity. */
export const COLLAB_ENTITIES = ["Property", "Unit", "Lease", "Person"] as const;
export type CollabEntity = (typeof COLLAB_ENTITIES)[number];

export function isCollabEntity(v: unknown): v is CollabEntity {
  return typeof v === "string" && (COLLAB_ENTITIES as readonly string[]).includes(v);
}

/** Staff roles that work in the management app and take part in tasks and comments. */
export const STAFF_ROLES: UserRole[] = ["ADMIN", "VERWALTER", "BUCHHALTUNG"];

export function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

/** App path of a record (without locale prefix). */
export function entityPath(entity: CollabEntity, id: string): string {
  switch (entity) {
    case "Property":
      return `/properties/${id}`;
    case "Unit":
      return `/units/${id}`;
    case "Lease":
      return `/leases/${id}`;
    case "Person":
      return `/persons/${id}`;
  }
}

export const COMMENT_MAX = 5000;

type Candidate = { id: string; name: string };

/**
 * Users actually mentioned in `body`: the browser sends the ids it picked from the
 * @-list, and an id only counts if it is a known candidate and "@Name" is still in the
 * text (the user may have deleted the mention before sending). Never the author.
 */
export function resolveMentions(body: string, claimedIds: string[], candidates: Candidate[], authorId: string): string[] {
  const claimed = new Set(claimedIds);
  const out: string[] = [];
  for (const c of candidates) {
    if (c.id === authorId || !claimed.has(c.id) || out.includes(c.id)) continue;
    if (body.includes(`@${c.name}`)) out.push(c.id);
  }
  return out;
}

export type Segment = { text: string; mention?: boolean };

/** Splits a comment into plain text and "@Name" mention segments for display. */
export function splitMentions(body: string, names: string[]): Segment[] {
  const tokens = [...new Set(names.filter(Boolean))].map((n) => `@${n}`).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return body ? [{ text: body }] : [];
  const out: Segment[] = [];
  let buf = "";
  let i = 0;
  outer: while (i < body.length) {
    if (body[i] === "@") {
      for (const tok of tokens) {
        if (body.startsWith(tok, i)) {
          if (buf) out.push({ text: buf });
          buf = "";
          out.push({ text: tok, mention: true });
          i += tok.length;
          continue outer;
        }
      }
    }
    buf += body[i];
    i++;
  }
  if (buf) out.push({ text: buf });
  return out;
}

/**
 * Active "@query" at the cursor, for the mention picker: the text after the last "@"
 * before the cursor, as long as that "@" starts a word and the query has no line break.
 */
export function mentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 40) return null;
  return { start: at, query };
}

/** Order for work lists: overdue first, then by due date, undated last, then oldest first. */
export function byUrgency<T extends { dueDate: Date | null; createdAt: Date }>(a: T, b: T): number {
  const ad = a.dueDate?.getTime() ?? Infinity;
  const bd = b.dueDate?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export type TimelineItem =
  | { kind: "comment"; at: Date; id: string; authorId: string | null; authorName: string; body: string; mentions: string[] }
  | { kind: "audit"; at: Date; id: string; userName: string | null; action: string; summary: string | null }
  | { kind: "task"; at: Date; id: string; title: string; done: boolean; doneAt: Date | null; assigneeName: string | null; createdByName: string | null };

/** Newest first; a finished task shows at the time it was finished. */
export function mergeTimeline(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
}
