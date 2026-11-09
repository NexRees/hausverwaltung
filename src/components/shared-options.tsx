"use client";

// nexrees: option lists (people, units, ...) shared by every dialog on a page. Pages with one edit
// dialog per row used to render the full option list into each row, so the page grew with
// rows x options (44 MB+ for the units page at 2,000 units). The page now sends each list once
// through this provider and fields refer to it by name.
import { createContext, useContext, useMemo, useState } from "react";

export type Opt = { value: string; label: string };
const Ctx = createContext<Record<string, Opt[]>>({});

export function SharedOptionsProvider({ lists, children }: { lists: Record<string, Opt[]>; children: React.ReactNode }) {
  const parent = useContext(Ctx);
  const merged = useMemo(() => ({ ...parent, ...lists }), [parent, lists]);
  return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
}

export function useSharedOptions(name: string): Opt[] {
  return useContext(Ctx)[name] ?? [];
}

export function SharedOptionElements({ list }: { list: string }) {
  const options = useSharedOptions(list);
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );
}

/** Checkbox list with a quick filter, for lists that can hold thousands of entries. */
export function SharedCheckboxes({ list, options: inline, name, defaultValues = [] }: { list?: string; options?: Opt[]; name: string; defaultValues?: string[] }) {
  const shared = useSharedOptions(list ?? "");
  const options = inline ?? shared;
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  if (options.length === 0) return <p className="px-1 text-sm text-muted-foreground">—</p>;
  return (
    <>
      {options.length > 12 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="…"
          aria-label="Filter"
          className="mb-1 h-7 w-full rounded-md border border-input bg-transparent px-2 text-sm"
        />
      )}
      {options.map((o) => {
        // Hidden instead of removed, so checked boxes stay in the form when filtered out.
        const hidden = needle !== "" && !o.label.toLowerCase().includes(needle);
        return (
          <label key={o.value} className="flex items-center gap-2 px-1 py-0.5 text-sm" hidden={hidden}>
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="size-4 rounded border-input" />
            {o.label}
          </label>
        );
      })}
    </>
  );
}
