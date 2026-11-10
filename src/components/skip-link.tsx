import { getTranslations } from "next-intl/server";

// nexrees: "Zum Inhalt springen" — visible only when focused (WCAG 2.4.1 Bypass Blocks).
export async function SkipLink({ target = "main" }: { target?: string }) {
  const t = await getTranslations("a11y");
  return (
    <a
      href={`#${target}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
    >
      {t("skipToContent")}
    </a>
  );
}
