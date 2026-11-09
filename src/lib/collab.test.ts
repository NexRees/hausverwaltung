import { describe, it, expect } from "vitest";
import { byUrgency, entityPath, isCollabEntity, mentionQuery, mergeTimeline, resolveMentions, splitMentions, type TimelineItem } from "./collab";

const users = [
  { id: "u1", name: "Anna Berg" },
  { id: "u2", name: "Anna" },
  { id: "u3", name: "Tom Kurz" },
];

describe("resolveMentions", () => {
  it("keeps picked users whose @Name is still in the text", () => {
    expect(resolveMentions("Bitte @Anna Berg prüfen", ["u1", "u3"], users, "u9")).toEqual(["u1"]);
  });
  it("ignores ids that are not candidates (other tenant, portal user)", () => {
    expect(resolveMentions("@Anna Berg", ["x"], users, "u9")).toEqual([]);
  });
  it("never notifies the author", () => {
    expect(resolveMentions("@Tom Kurz notiz", ["u3"], users, "u3")).toEqual([]);
  });
  it("does not count a name the browser did not pick", () => {
    expect(resolveMentions("@Tom Kurz", [], users, "u9")).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("prefers the longest matching name", () => {
    expect(splitMentions("Hi @Anna Berg!", ["Anna", "Anna Berg"])).toEqual([
      { text: "Hi " },
      { text: "@Anna Berg", mention: true },
      { text: "!" },
    ]);
  });
  it("leaves unknown @words as text", () => {
    expect(splitMentions("mail @foo", ["Anna"])).toEqual([{ text: "mail @foo" }]);
  });
  it("handles no names", () => {
    expect(splitMentions("text", [])).toEqual([{ text: "text" }]);
  });
});

describe("mentionQuery", () => {
  it("finds the query after @ at the cursor", () => {
    expect(mentionQuery("Hallo @An", 9)).toEqual({ start: 6, query: "An" });
  });
  it("ignores @ inside a word (e-mail address)", () => {
    expect(mentionQuery("a@b.de", 6)).toBeNull();
  });
  it("stops at a line break", () => {
    expect(mentionQuery("@An\nx", 5)).toBeNull();
  });
});

describe("byUrgency", () => {
  it("sorts by due date, undated last, then oldest", () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { id: "none-new", dueDate: null, createdAt: d("2026-02-01") },
      { id: "late", dueDate: d("2026-03-01"), createdAt: d("2026-01-01") },
      { id: "none-old", dueDate: null, createdAt: d("2026-01-01") },
      { id: "soon", dueDate: d("2026-01-15"), createdAt: d("2026-01-01") },
    ];
    expect(rows.sort(byUrgency).map((r) => r.id)).toEqual(["soon", "late", "none-old", "none-new"]);
  });
});

describe("timeline", () => {
  it("is newest first", () => {
    const items: TimelineItem[] = [
      { kind: "audit", at: new Date(1), id: "a", userName: null, action: "CREATE", summary: null },
      { kind: "comment", at: new Date(3), id: "c", authorId: null, authorName: "A", body: "x", mentions: [] },
      { kind: "task", at: new Date(2), id: "t", title: "T", done: false, doneAt: null, assigneeName: null, createdByName: null },
    ];
    expect(mergeTimeline(items).map((i) => i.id)).toEqual(["c", "t", "a"]);
  });
});

describe("entities", () => {
  it("validates and links", () => {
    expect(isCollabEntity("Lease")).toBe(true);
    expect(isCollabEntity("User")).toBe(false);
    expect(entityPath("Unit", "x")).toBe("/units/x");
  });
});
