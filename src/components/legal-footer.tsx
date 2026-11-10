// nexrees: Impressum (§ 5 DDG), Datenschutz (Art. 13 DSGVO) and the AGPL source of the running
// version (AGPL § 13) on every page a visitor or portal user can reach without the staff app.
import { useTranslations } from "next-intl";
import { BRAND, sourceUrlFor } from "@/lib/brand";
import { APP_SHA } from "@/lib/version";

export function LegalFooter({
  tone = "default",
  showCompliance = false,
  className = "",
}: {
  /** "onDark" for the login and setup backdrop. */
  tone?: "default" | "onDark";
  /** Adds the DSGVO/GoBD line (login page). */
  showCompliance?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  const links = [
    { href: BRAND.imprintUrl, label: t("legal.imprint") },
    { href: BRAND.privacyUrl, label: t("legal.privacy") },
    { href: sourceUrlFor(APP_SHA), label: t("about.source") },
  ];
  const text = tone === "onDark" ? "text-white/80" : "text-muted-foreground";
  const link =
    tone === "onDark"
      ? "text-white/90 hover:text-white focus-visible:ring-white/70"
      : "text-muted-foreground hover:text-foreground focus-visible:ring-ring";

  return (
    <footer className={`flex flex-col items-center gap-1 text-center text-xs ${text} ${className}`}>
      <nav aria-label={t("legal.label")}>
        <ul className="flex flex-wrap items-center justify-center gap-x-4">
          {links.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                rel="noopener"
                className={`inline-flex min-h-6 items-center rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 ${link}`}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p>
        © {new Date().getFullYear()} {BRAND.name}
        {showCompliance && <> · {t("legal.compliance")}</>}
      </p>
    </footer>
  );
}
