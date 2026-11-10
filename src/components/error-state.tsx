"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PAGE_CONTENT_ATTR, documentTitle } from "@/components/page-title";

/** Outside the app shell (login, portal, unknown address) nothing else names the tab. */
function useStandaloneTitle(title: string) {
  useEffect(() => {
    if (!document.querySelector(`[${PAGE_CONTENT_ATTR}]`)) document.title = documentTitle(title);
  }, [title]);
}

/**
 * nexrees: what people (and agents) see when a page fails to render. Never shows the raw error
 * text (in production that is a React/Next digest message); shows the digest as a reference that
 * matches the server log line, and offers a retry and a way back.
 * The h1 uses the page-heading style: inside the app shell it moves into the top bar like every
 * other page title; on login/portal pages it shows in place.
 */
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations("ux");
  useEffect(() => {
    console.error(error);
  }, [error]);
  useStandaloneTitle(t("errorTitle"));
  const digest =
    error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  return (
    <div role="alert" data-state="error" className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <TriangleAlert aria-hidden className="size-10 text-destructive" />
      <h1 className="text-2xl font-semibold tracking-tight">{t("errorTitle")}</h1>
      <p className="text-sm">{t("errorBody")}</p>
      {digest && (
        <p className="text-xs text-muted-foreground">
          {t("errorRef", { ref: digest })}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {retry && (
          <Button type="button" onClick={() => retry()}>
            <RotateCcw aria-hidden className="size-4" />
            {t("retry")}
          </Button>
        )}
        <Button variant="outline" render={<Link href="/" />}>
          {t("toDashboard")}
        </Button>
      </div>
    </div>
  );
}

/** nexrees: a missing page or a deleted record, with a way back. */
export function NotFoundState() {
  const t = useTranslations("ux");
  useStandaloneTitle(t("notFoundTitle"));
  return (
    <div data-state="not-found" className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <p aria-hidden className="font-heading text-5xl font-semibold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="text-sm">{t("notFoundBody")}</p>
      <Button variant="outline" render={<Link href="/" />}>
        {t("toDashboard")}
      </Button>
    </div>
  );
}
