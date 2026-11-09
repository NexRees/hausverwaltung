"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";

// nexrees: selbst gehosteter PDF-Viewer (pdf.js, Apache-2.0) statt des zur Laufzeit
// von mudex.org geladenen Viewers. Rendert im Browser auf <canvas>; Seiten werden
// erst gezeichnet, wenn sie in den sichtbaren Bereich scrollen (große PDFs bleiben flüssig).

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PdfViewer({ url }: { url: string }) {
  const t = useTranslations("documents");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(2); // Index in ZOOMS → 100 %

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(
            new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
            { type: "module" },
          );
        }
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const data = new Uint8Array(await res.arrayBuffer());
        // Keine XFA-Formulare; pdf.js führt keine PDF-Skripte aus: nur anzeigen.
        const t = pdfjs.getDocument({ data, enableXfa: false });
        task = t;
        const loaded = await t.promise;
        if (cancelled) t.destroy();
        else setDoc(loaded);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy(); // gibt das Dokument im (geteilten) Worker frei
    };
  }, [url]);

  if (error) return <p className="text-muted-foreground p-6 text-sm">{t("previewFailed")}</p>;
  if (!doc) return <p className="text-muted-foreground p-6 text-sm">{t("previewLoading")}</p>;

  const scale = ZOOMS[zoom];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1 text-sm">
        <Button variant="ghost" size="icon" aria-label={t("zoomOut")} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
          <Minus className="size-4" />
        </Button>
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)} %</span>
        <Button variant="ghost" size="icon" aria-label={t("zoomIn")} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>
          <Plus className="size-4" />
        </Button>
        <span className="text-muted-foreground ml-auto">{t("pageCount", { count: doc.numPages })}</span>
      </div>
      <div className="flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
        {Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={`${i}-${scale}`} doc={doc} pageNumber={i + 1} scale={scale} />
        ))}
      </div>
    </div>
  );
}

function PdfPage({ doc, pageNumber, scale }: { doc: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  // Platzhaltergröße A4 bei 96 dpi, bis die echte Seitengröße bekannt ist.
  const [size, setSize] = useState({ w: 794 * scale, h: 1123 * scale });

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: { cancel(): void; promise: Promise<void> } | undefined;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      // PDF-Punkte (72 dpi) → CSS-Pixel (96 dpi), dazu Geräteauflösung für scharfe Schrift.
      const viewport = page.getViewport({ scale: (scale * 96) / 72 });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      setSize({ w: viewport.width, h: viewport.height });
      task = page.render({
        canvas: c,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNumber, scale]);

  return (
    <div ref={holder} className="mx-auto mb-4 bg-white shadow" style={{ width: size.w, height: size.h }}>
      <canvas ref={canvas} aria-label={`Seite ${pageNumber}`} />
    </div>
  );
}
