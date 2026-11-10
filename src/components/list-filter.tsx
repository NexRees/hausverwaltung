import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Plain GET form: filters a paged list by text and resets to page 1. `keep` carries other filters. */
export async function ListFilter({ q, keep = {}, total }: { q: string; keep?: Record<string, string | undefined>; total?: number }) {
  const t = await getTranslations();
  return (
    <form method="get" role="search" className="flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative w-full max-w-xs">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder={t("common.search")} className="pl-8" aria-label={t("common.search")} />
      </div>
      <Button type="submit" size="sm" variant="outline">
        {t("common.search")}
      </Button>
      {/* nexrees: the hit count says what the number means (role=status; data-total for agents) */}
      {total !== undefined && (
        <span role="status" className="text-sm text-muted-foreground" data-total={total}>
          {t("a11y.resultCount", { count: total })}
        </span>
      )}
    </form>
  );
}
