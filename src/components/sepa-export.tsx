"use client";

// nexrees: create a SEPA direct-debit file (POST, recorded so nobody is debited twice) and list
// the recent files; a file that was never submitted to the bank can be cancelled.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { cancelSepaCollection } from "@/server/actions/finances";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/delete-button";

export type SepaFile = {
  id: string;
  collectionDate: string; // YYYY-MM-DD
  count: number;
  total: number;
  createdByName: string | null;
  cancelled: boolean;
};

const de = (ymd: string) => ymd.split("-").reverse().join(".");

export function SepaExport({ earliest, files }: { earliest: string; files: SepaFile[] }) {
  const t = useTranslations("nexrees.sepa");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create(fd: FormData) {
    setBusy(true);
    try {
      const res = await fetch("/api/export/sepa", { method: "POST", body: fd });
      if (!res.ok) {
        toast.error(await res.text());
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "sepa-lastschrift.xml";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("created"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-3 rounded-md border p-3">
      <form action={create} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="sepaDate" className="text-xs text-muted-foreground">
            {t("date")}
          </label>
          <Input id="sepaDate" name="date" type="date" min={earliest} defaultValue={earliest} className="h-8 w-40" required />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          <Download className="size-4" />
          {t("create")}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {t("line", { date: de(f.collectionDate), count: f.count, total: money(f.total, locale) })}
                {f.createdByName && <span className="text-xs text-muted-foreground"> · {f.createdByName}</span>}
              </span>
              {f.cancelled ? (
                <Badge variant="secondary">{t("cancelled")}</Badge>
              ) : (
                <DeleteButton action={cancelSepaCollection} id={f.id} label={t("cancel")} description={t("cancelDesc")} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
