"use client";

// nexrees: the page title lives in the top bar. Pages keep rendering their own <h1> (no change to
// ~30 upstream pages, so upstream merges stay clean); globals.css hides it inside the page content
// and this component shows its text in the header instead.
// It also keeps document.title in step ("Einheiten · NexRees"), so every page and record has its own
// browser/tab title, agents can tell pages apart, and Next's route announcer reads the new title
// to screen-reader users after a client-side navigation (it announces document.title on each route
// change; without this every page had the same title and navigation was silent).
import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { BRAND } from "@/lib/brand";

export const PAGE_CONTENT_ATTR = "data-page-content";

function readTitle(): string {
  const h1 = document.querySelector(`[${PAGE_CONTENT_ATTR}] h1`);
  return h1?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** "Einheiten" → "Einheiten · NexRees"; empty → just the product name. */
export function documentTitle(pageTitle: string): string {
  return pageTitle ? `${pageTitle} · ${BRAND.name}` : BRAND.name;
}

export function PageTitle() {
  const pathname = usePathname();
  const [title, setTitle] = useState("");

  useEffect(() => {
    const root = document.querySelector(`[${PAGE_CONTENT_ATTR}]`);
    const update = () => {
      const next = readTitle();
      setTitle(next);
      // Set synchronously (a MutationObserver callback runs before React's passive effects), so the
      // announcer sees the new page's title in the same commit. While a loading skeleton shows
      // (no h1 yet) the previous title stays, which the announcer does not repeat.
      if (next) document.title = documentTitle(next);
    };
    update();
    if (!root) return;
    // Streaming, client navigation and in-page edits (renaming an entity) all change the h1.
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <h1 className="min-w-0 truncate text-base font-semibold tracking-tight" title={title || undefined}>
      {title}
    </h1>
  );
}
