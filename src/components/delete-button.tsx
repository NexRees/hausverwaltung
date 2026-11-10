"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation"; // push mit Sprachpräfix
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { actionErrorMessage } from "@/components/crud-dialog";

/** nexrees: a delete action may refuse with a reason people can act on, e.g. "Einheit hat Buchungen". */
export type DeleteResult = void | { error?: string };

/**
 * nexrees: the row a button sits in names the record ("Einheit W01"), so the button and the
 * confirmation say what will be deleted. Without an explicit itemName, the first line of the
 * table row's first cell (or the nearest [data-item-name]) is used; pass itemName where that cell
 * is a date or a type rather than the record's name.
 */
function nameFromContext(el: HTMLElement | null): string | null {
  if (!el) return null;
  const marked = el.closest<HTMLElement>("[data-item-name]")?.dataset.itemName;
  if (marked) return marked;
  const row = el.closest("tr");
  const cell = row?.querySelector<HTMLElement>("td, th");
  if (!cell || cell.contains(el)) return null;
  // innerText keeps the line breaks between stacked parts (name above address, badge below), so
  // only the first line is used; textContent would glue them together.
  const raw = cell.innerText || cell.textContent || "";
  const text = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);
  return text && text.length <= 80 ? text : null;
}

export function DeleteButton({
  action,
  id,
  label,
  description,
  redirectTo,
  itemName,
}: {
  action: (fd: FormData) => Promise<DeleteResult>;
  id: string;
  label?: string; // z. B. „Verbindung trennen“ statt „Löschen“ (#53)
  description?: string;
  redirectTo?: string; // nach dem Löschen dorthin (z. B. gelöschte Unterhaltung, #50)
  /** Name of the record, shown in the button's accessible name and the confirmation title. */
  itemName?: string;
}) {
  const t = useTranslations("common");
  const tA11y = useTranslations("a11y");
  const tUx = useTranslations("ux");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [derivedName, setDerivedName] = useState<string | null>(null);
  useEffect(() => {
    if (itemName) return;
    const el = triggerRef.current;
    const update = () => setDerivedName(nameFromContext(el)); // same string: no re-render
    update();
    // A refresh can rename the record in place (same row, new text): follow it.
    const scope = el?.closest("[data-item-name], tr");
    if (!scope) return;
    const observer = new MutationObserver(update);
    observer.observe(scope, { childList: true, subtree: true, characterData: true, attributeFilter: ["data-item-name"] });
    return () => observer.disconnect();
  }, [itemName]);
  const name = itemName ?? derivedName;

  const buttonLabel = label ?? (name ? tA11y("deleteItem", { name }) : t("delete"));
  const title = label ? `${label}?` : name ? tA11y("deleteItemTitle", { name }) : t("deleteTitle");

  function confirm() {
    const fd = new FormData();
    fd.set("id", id);
    start(async () => {
      try {
        const res = await action(fd);
        if (res && res.error) {
          // nexrees: a refusal keeps the dialog open and says why, instead of a silent no-op.
          toast.error(tUx("deleteBlocked", { reason: res.error }));
          return;
        }
        setOpen(false);
        toast.success(t("deleted"));
        if (redirectTo) router.push(redirectTo);
        else router.refresh(); // abhängige Übersichten sofort aktualisieren
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) {
          throw e;
        }
        console.error(e);
        toast.error(e instanceof TypeError ? actionErrorMessage(e, tUx) : t("deleteFailed"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={buttonLabel}
            title={buttonLabel}
            data-action="delete"
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("deleteDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending || undefined}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {label ?? t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
