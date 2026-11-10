"use client";

import * as React from "react";
import { startTransition, useActionState, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { outboxToast } from "@/components/outbox-toast";
import type { ActionState } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldErrorsProvider, fieldErrorId } from "@/components/field-errors";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** nexrees: Next.js digests and fetch failures are not messages for people; map them to text. */
export function actionErrorMessage(e: unknown, t: (key: string) => string): string {
  if (e instanceof TypeError) return t("offline"); // "Failed to fetch": no connection / server gone
  return t("failed");
}

export function CrudDialog({
  trigger,
  title,
  description,
  action,
  submitLabel,
  extraActions,
  children,
}: {
  trigger: React.ReactElement;
  title: string;
  /** nexrees: names the record the dialog acts on (e.g. "Einheit W01 · Lindenstraße 4"). */
  description?: string;
  action: Action;
  submitLabel?: string;
  extraActions?: React.ReactNode; // weitere Submit-Buttons, z. B. „Als Entwurf speichern“
  children: React.ReactNode;
}) {
  const t = useTranslations("common");
  const tUx = useTranslations("ux");
  const tRoot = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errId = useId();
  const dirty = useRef(false);
  // Wirft die Server-Action (statt {error} zurückzugeben), blieb der Dialog
  // sonst offen ohne Hinweis. Fehler abfangen und anzeigen; echte Redirects
  // (NEXT_REDIRECT, z. B. Login-Guard) müssen durchgereicht werden.
  // nexrees: never show e.message: in production it is a React/Next digest text
  // ("Minified React error #441 …") or "Failed to fetch".
  const safeAction: Action = async (prev, fd) => {
    try {
      return await action(prev, fd);
    } catch (e) {
      if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) {
        throw e;
      }
      console.error(e);
      return { error: actionErrorMessage(e, tUx) };
    }
  };
  const [state, formAction, pending] = useActionState<ActionState, FormData>(safeAction, {});

  // nexrees: errors from a previous opening must not show again when the dialog is reopened.
  const [staleState, setStaleState] = useState<ActionState | null>(null);
  const visible: ActionState = state === staleState ? {} : state;
  const fieldErrors = visible.fieldErrors ?? {};

  // Erfolg genau EINMAL je Absenden behandeln. Ohne den Ref-Guard feuerte der
  // Effekt bei jedem Re-Render (durch router.refresh) erneut → Toast-Endlosschleife.
  const handledState = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handledState.current !== state) {
      handledState.current = state;
      dirty.current = false;
      setOpen(false);
      outboxToast(tRoot, state.notice, t("saved"));
      router.refresh(); // abhängige Übersichten sofort aktualisieren
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // nexrees: after a failed submit, put focus on the first marked field, or on the message.
  useEffect(() => {
    if (!open || !visible.error) return;
    const form = formRef.current;
    const target =
      form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? document.getElementById(errId);
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // The label of the first field with an error, so the summary says which field is wrong. Looked
  // up before paint and tied to its field, so the alert never pairs one field's label with
  // another field's message.
  const firstErrorKey = Object.keys(fieldErrors)[0] ?? null;
  const [errorField, setErrorField] = useState<{ key: string; label: string } | null>(null);
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!firstErrorKey || !form) return setErrorField(null);
    const label = form.querySelector(`label[for="${CSS.escape(firstErrorKey)}"]`)?.textContent?.trim();
    setErrorField(label ? { key: firstErrorKey, label } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function changeOpen(next: boolean) {
    // nexrees: closing with Escape, the overlay or ✕ no longer silently throws typed input away.
    if (!next && dirty.current && !window.confirm(tUx("discardChanges"))) return;
    if (next) {
      dirty.current = false;
      setStaleState(state);
    }
    setOpen(next);
  }

  // nexrees: submit through the action state instead of <form action>. React resets a form after
  // every <form action> submission, so one validation error used to wipe everything typed.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* key remountet Formular je Öffnung → frische Felder */}
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onInput={() => (dirty.current = true)}
          key={open ? "open" : "closed"}
          className="space-y-4"
          aria-describedby={visible.error ? errId : undefined}
          aria-busy={pending || undefined}
        >
          <FieldErrorsProvider errors={fieldErrors}>{children}</FieldErrorsProvider>
          {/* nexrees: announced (role=alert), focusable, and names the field when it can */}
          <p
            id={errId}
            role="alert"
            tabIndex={-1}
            className={visible.error ? "text-sm text-destructive outline-none" : "sr-only"}
          >
            {visible.error
              ? errorField && errorField.key === firstErrorKey
                ? `${errorField.label}: ${visible.error}`
                : visible.error
              : ""}
          </p>
          <DialogFooter>
            {extraActions}
            <Button type="submit" disabled={pending} focusableWhenDisabled>
              {submitLabel ?? t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { fieldErrorId };
