"use client";

// nexrees: the page title lives in the top bar. Pages keep rendering their own <h1> (no change to
// ~30 upstream pages, so upstream merges stay clean); globals.css hides it inside the page content
// and this component shows its text in the header instead.
// It also keeps document.title in step ("Einheiten · NexRees"), so every page and record has its own
// browser/tab title, agents can tell pages apart, and Next's route announcer reads the new title
// (below). Without this every page had the same title and navigation was silent for screen readers.
import { useEffect, useRef, useState } from "react";
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
  const [tabTitle, setTabTitle] = useState("");
  // Announces the new page after a client-side navigation, once its heading is there (it often
  // streams in after the loading skeleton). Next's own route announcer is hidden in the app shell
  // (globals.css): it reads document.title at the route change, before a streamed page has set
  // it, so it announced the previous page's title.
  const [announcement, setAnnouncement] = useState({ path: "", text: "" });
  const mounted = useRef(false);
  const announced = announcement.path === pathname ? announcement.text : "";

  useEffect(() => {
    const root = document.querySelector(`[${PAGE_CONTENT_ATTR}]`);
    let pending = mounted.current; // not on the first load: screen readers read the new document
    mounted.current = true;
    const update = () => {
      const next = readTitle();
      setTitle(next);
      if (!next) return; // loading skeleton: the tab keeps the previous title until the page is there
      setTabTitle(next);
      const tab = documentTitle(next);
      if (document.title !== tab) document.title = tab;
      if (pending) {
        pending = false;
        setAnnouncement({ path: pathname, text: next });
      }
    };
    update();
    if (!root) return;
    // Streaming, client navigation and in-page edits (renaming an entity) all change the h1.
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <>
      {/* React hoists this into <head>; it is also the server-rendered tab title */}
      <title>{documentTitle(tabTitle)}</title>
      <h1 className="min-w-0 truncate text-base font-semibold tracking-tight" title={title || undefined}>
        {title}
      </h1>
      <span role="status" className="sr-only" data-route-announcement>
        {announced}
      </span>
    </>
  );
}
