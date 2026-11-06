// nexrees: shows which environment this is (APP_ENV, set per deployment at runtime, so the same
// image runs in staging and production). Production and unset show nothing.

const LABELS: Record<string, string> = {
  staging: "Staging",
  development: "Entwicklung",
  test: "Test",
};

export function envLabel(env: string | undefined = process.env.APP_ENV): string | null {
  const key = env?.trim().toLowerCase();
  if (!key || key === "production" || key === "prod") return null;
  return LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function EnvBadge({ className = "" }: { className?: string }) {
  const label = envLabel();
  if (!label) return null;
  return (
    <span
      title={`Umgebung: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 ${className}`}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
      {label}
    </span>
  );
}
