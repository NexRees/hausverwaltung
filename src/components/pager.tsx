import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** Seitenweise blättern (Audit-Log, Finanzen #53). `href(p)` liefert die URL für Seite p. */
// nexrees: a named navigation landmark with named prev/next links (rel=prev/next), so screen
// readers and agents can page through lists; the disabled ends are not links at all.
export async function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const t = await getTranslations();
  const prev = t("a11y.previousPage");
  const next = t("a11y.nextPage");
  return (
    <nav aria-label={t("a11y.pagination")} className="flex items-center justify-between px-1 text-sm text-muted-foreground">
      <span>{t("audit.pageOf", { page, pages })}</span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label={prev}
          title={prev}
          disabled={page <= 1}
          render={page <= 1 ? <span /> : <Link href={href(page - 1)} rel="prev" />}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={next}
          title={next}
          disabled={page >= pages}
          render={page >= pages ? <span /> : <Link href={href(page + 1)} rel="next" />}
        >
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
