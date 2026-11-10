import { getTranslations } from "next-intl/server";
import { Building2, DoorOpen, Users, FileSignature, FileText, Wrench } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { searchEntities, type SearchEntity, type SearchHit } from "@/lib/search";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// nexrees: one search (src/lib/search.ts) for this page and the API: every word must match, so
// "Erika Mustermann" finds the person; people link to their page; tickets are searched too; group
// counts are real totals ("20 of 134"), not the number shown.
const CAP = 20;
const GROUPS: { entity: SearchEntity; key: string; icon: typeof Building2 }[] = [
  { entity: "property", key: "properties", icon: Building2 },
  { entity: "unit", key: "units", icon: DoorOpen },
  { entity: "person", key: "persons", icon: Users },
  { entity: "lease", key: "leases", icon: FileSignature },
  { entity: "ticket", key: "tickets", icon: Wrench },
  { entity: "document", key: "documents", icon: FileText },
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const t = await getTranslations();
  const tenantId = user.tenantId;
  const q = (sp.q ?? "").trim();

  const result = await searchEntities(tenantId, q, { limit: CAP, entities: GROUPS.map((g) => g.entity) });
  const total = result.total;

  const sub = (h: SearchHit) =>
    h.entity === "ticket" && h.status
      ? [t(`ticketStatus.${h.status}`), h.sublabel].filter(Boolean).join(" · ")
      : h.sublabel;

  const groups = GROUPS.map((g) => {
    const found = result.groups.find((r) => r.entity === g.entity);
    return {
      key: g.key,
      icon: g.icon,
      total: found?.total ?? 0,
      items: (found?.hits ?? []).map((h) => ({
        id: h.id,
        label: h.label,
        sub: sub(h),
        href: h.href,
        raw: h.href.startsWith("/api/"), // externer API-Pfad → normaler <a> ohne Locale-Präfix
      })),
    };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("search.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {q ? t("search.resultsFor", { q, count: total }) : t("search.prompt")}
        </p>
      </div>

      {q && total === 0 && <p className="text-sm text-muted-foreground">{t("search.noResults")}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <g.icon className="size-4" />
                {t(`nav.${g.key}`)} ({g.total})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {g.items.map((it) => {
                const cls = "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted";
                const inner = (
                  <>
                    <span className="font-medium">{it.label}</span>
                    {it.sub && <span className="text-right text-xs text-muted-foreground">{it.sub}</span>}
                  </>
                );
                return it.raw ? (
                  <a key={it.id} href={it.href} target="_blank" rel="noopener" className={cls}>
                    {inner}
                  </a>
                ) : (
                  <Link key={it.id} href={it.href} className={cls}>
                    {inner}
                  </Link>
                );
              })}
              {g.total > g.items.length && (
                <p className="px-2 pt-1 text-xs text-muted-foreground">
                  {t("search.showing", { shown: g.items.length, total: g.total })}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
