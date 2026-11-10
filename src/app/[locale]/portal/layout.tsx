import { getLocale } from "next-intl/server";
import { APP_TIME_ZONE } from "@/lib/format";
import { Building2 } from "lucide-react";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell } from "@/components/notification-bell";
import { InfoDrawer } from "@/components/info-drawer";
import { BRAND } from "@/lib/brand";
import { EnvBadge } from "@/components/env-badge";
import { LegalFooter } from "@/components/legal-footer";
import { SkipLink } from "@/components/skip-link";

// nexrees: tenants and owners see their management company (name, logo), not the software vendor's
// beta notice and issue tracker; the AGPL source link stays in the legal footer.
const PORTAL_ROLES = ["MIETER", "EIGENTUEMER", "HANDWERKER"];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await getLocale();
  const [notifs, unread, tenant] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, logoKey: true } }),
  ]);
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: APP_TIME_ZONE });
  const notifItems = notifs.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: dtf.format(n.createdAt),
  }));
  const companyName = tenant?.name ?? BRAND.name;
  const staff = !PORTAL_ROLES.includes(user.role);

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <SkipLink />
      {/* nexrees: the top bar stays in place while the page scrolls */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
        <Link href="/portal" className="flex min-w-0 items-center gap-2 font-semibold" title={companyName}>
          {tenant?.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/logo" alt="" className="size-7 shrink-0 rounded-md object-contain" />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-4" aria-hidden />
            </span>
          )}
          <span className="truncate">{companyName}</span>
        </Link>
        <span className="hidden sm:inline-flex">
          <EnvBadge className="ml-1" />
        </span>
        <div className="ml-auto flex shrink-0 items-center sm:gap-1">
          {staff && <InfoDrawer tenantName={companyName} />}
          <NotificationBell items={notifItems} unread={unread} />
          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} role={user.role} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 p-4 outline-none md:p-6">
        {children}
      </main>
      <LegalFooter className="px-4 pb-6 pt-2" />
    </div>
  );
}
