"use client";

import { useEffect, useState } from "react";
import { Download, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PdfViewer } from "@/components/pdf-viewer";
import { previewKind } from "@/lib/preview-kind";

// nexrees: Vorschau ohne Fremdskript. Bisher hostete ein iframe den Mudex-Viewer, der
// zur Laufzeit von mudex.org geladen wurde. Jetzt: PDF über pdf.js (gebündelt), Bilder,
// Audio/Video und Text nativ im Browser; Office-Dateien u. Ä. als Download.
// Die Datei kommt weiter über den zugriffsgeschützten Endpunkt (?inline=1).
export function DocumentPreview({
  id,
  name,
  mime,
  attachment,
}: {
  id: string;
  name: string;
  mime: string;
  attachment?: boolean; // noch nicht übernommener Mail-Anhang (#52)
}) {
  const t = useTranslations("documents");
  const [open, setOpen] = useState(false);
  const base = attachment ? "/api/inbound-attachments" : "/api/documents";
  const url = `${base}/${encodeURIComponent(id)}?inline=1`;
  const kind = previewKind(mime, name);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={t("preview")} title={t("preview")}>
            <Eye className="size-4" />
          </Button>
        }
      />
      <DialogContent className="w-[95vw] max-w-[1100px] sm:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{name}</DialogTitle>
        </DialogHeader>
        {open && (
          <div className="h-[80vh] w-full overflow-hidden rounded-md border bg-white dark:bg-neutral-950">
            {kind === "pdf" && <PdfViewer url={url} />}
            {kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element -- geschützte Datei, kein next/image
              <img src={url} alt={name} className="mx-auto h-full max-w-full object-contain" />
            )}
            {kind === "audio" && <audio src={url} controls className="m-6 w-[calc(100%-3rem)]" />}
            {kind === "video" && <video src={url} controls className="h-full w-full bg-black" />}
            {kind === "text" && <TextPreview url={url} />}
            {kind === "none" && (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-muted-foreground text-sm">{t("previewUnsupported")}</p>
                <Button render={<a href={url.replace("?inline=1", "")} />}>
                  <Download className="size-4" />
                  {t("download")}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TEXT_LIMIT = 1_000_000; // Zeichen; größere Textdateien nur angeschnitten zeigen

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((s) => !cancelled && setText(s.slice(0, TEXT_LIMIT)))
      .catch(() => !cancelled && setText(""));
    return () => {
      cancelled = true;
    };
  }, [url]);
  // Als Text, nie als HTML: Inhalte können aus fremden Mails stammen.
  return <pre className="h-full overflow-auto p-4 text-sm whitespace-pre-wrap">{text ?? "…"}</pre>;
}
