"use client";
// Copyright (c) 2026 NexRees.

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Storno of a free journal entry: asks first, then posts the reversing entry. */
export function StornoButton({
  action,
  id,
  seq,
}: {
  action: (fd: FormData) => Promise<void | { error: string }>;
  id: string;
  seq: number;
}) {
  const t = useTranslations("ledger");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const label = t("stornoOf", { seq });

  function confirm() {
    const fd = new FormData();
    fd.set("id", id);
    start(async () => {
      const res = await action(fd).catch(() => ({ error: t("stornoFailed") }));
      if (res && res.error) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(t("stornoDone", { seq }));
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} title={label} data-action="storno">
            <Undo2 aria-hidden className="size-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("stornoTitle", { seq })}</AlertDialogTitle>
          <AlertDialogDescription>{t("stornoDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
            {t("storno")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
