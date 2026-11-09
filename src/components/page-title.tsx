"use client";

// nexrees: the page title lives in the top bar. Pages keep rendering their own <h1> (no change to
// ~30 upstream pages, so upstream merges stay clean); globals.css hides it inside the page content
// and this component shows its text in the header instead.
import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";

export const PAGE_CONTENT_ATTR = "data-page-content";

function readTitle(): string {
  const h1 = document.querySelector(`[${PAGE_CONTENT_ATTR}] h1`);
  return h1?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function PageTitle() {
  const pathname = usePathname();
  const [title, setTitle] = useState("");

  useEffect(() => {
    const root = document.querySelector(`[${PAGE_CONTENT_ATTR}]`);
    const update = () => setTitle(readTitle());
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
