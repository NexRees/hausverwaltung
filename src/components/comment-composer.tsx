"use client";

// nexrees: comment box with an @mention picker for colleagues.
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { addComment } from "@/server/actions/collab";
import { COMMENT_MAX, mentionQuery } from "@/lib/collab";
import type { ActionState } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type User = { id: string; name: string };

export function CommentComposer({ entity, entityId, users }: { entity: string; entityId: string; users: User[] }) {
  const t = useTranslations("collab");
  const router = useRouter();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<User[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addComment, {});
  const handled = useRef<ActionState | null>(null);
  const caret = useRef<number | null>(null); // where the cursor goes after inserting a mention

  // Runs right after the render that inserted the mention, before the next keystroke.
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      setText("");
      setPicked([]);
      router.refresh();
    }
  }, [state, router]);

  const matches = query
    ? users.filter((u) => u.name.toLowerCase().includes(query.query.toLowerCase())).slice(0, 6)
    : [];

  function update(value: string, cursor: number) {
    setText(value);
    setQuery(mentionQuery(value, cursor));
    setActive(0);
  }

  function pick(u: User) {
    if (!query || !ref.current) return;
    const cursor = ref.current.selectionStart ?? text.length;
    const insert = `@${u.name} `;
    const next = text.slice(0, query.start) + insert + text.slice(cursor);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, u]));
    setQuery(null);
    caret.current = query.start + insert.length;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { setQuery(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  // Only send mentions whose @Name is still in the text; the server checks again.
  const mentions = picked.filter((u) => text.includes(`@${u.name}`));

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="entityId" value={entityId} />
      {mentions.map((u) => (
        <input key={u.id} type="hidden" name="mentions" value={u.id} />
      ))}
      <div className="relative">
        <textarea
          ref={ref}
          name="body"
          rows={3}
          maxLength={COMMENT_MAX}
          value={text}
          placeholder={t("commentPlaceholder")}
          aria-label={t("comment")}
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          className={cn(
            "flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
            "dark:bg-input/30",
          )}
        />
        {matches.length > 0 && (
          <ul role="listbox" className="absolute left-2 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border bg-popover py-1 text-sm shadow-md">
            {matches.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(u); }}
                className={cn("cursor-pointer px-3 py-1.5", i === active && "bg-accent text-accent-foreground")}
              >
                {u.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("mentionHint")}</p>
        <Button type="submit" size="sm" disabled={pending || text.trim() === ""}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
