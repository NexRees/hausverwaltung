import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

// Sofortiges Feedback bei Navigation (Suspense-Grenze) — sonst blockt der Klick
// bis die Server-Component samt Prisma-Queries fertig ist und fühlt sich träge an.
// nexrees: data-state="loading" tells agents the page is not there yet. Screen readers hear about a
// slow page from the persistent live region in PageTitle; a status region inserted together with
// its text (like this one) is not reliably read, and aria-busy would hold it back entirely.
export default async function Loading() {
  const t = await getTranslations("a11y");
  return (
    <div role="status" data-state="loading" className="space-y-6">
      <span className="sr-only">{t("loadingPage")}</span>
      <div aria-hidden className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton aria-hidden className="h-64 w-full rounded-xl" />
    </div>
  );
}
