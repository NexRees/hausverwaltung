"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { navGroups } from "@/lib/nav";
import { activeNavGroup, isNavItemActive } from "@/lib/nav-active";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { BRAND } from "@/lib/brand";
import { SidebarAccount } from "@/components/sidebar-account";

export function AppSidebar({
  logoUrl,
  superAdmin = false,
  user,
  envLabel,
}: {
  logoUrl?: string;
  superAdmin?: boolean;
  user: { name?: string | null; email?: string | null; role: string; tenantName: string };
  envLabel?: string | null;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  // nexrees: sections collapse; only the one holding the current page is open (and marked).
  // Others open on click; moving to another page closes them again.
  const current = activeNavGroup(navGroups, pathname);
  const [opened, setOpened] = useState<{ path: string; keys: string[] }>({ path: pathname, keys: [] });
  const extra = opened.path === pathname ? opened.keys : [];
  // Icon-only sidebar: no section titles to click, so every icon stays visible.
  const iconOnly = state === "collapsed" && !isMobile;

  const toggle = (key: string) =>
    setOpened({
      path: pathname,
      keys: extra.includes(key) ? extra.filter((k) => k !== key) : [...extra, key],
    });

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl ?? "/icon.png"} alt={BRAND.name} className="size-8 rounded-md object-contain" />
          <div className="grid leading-tight">
            <span className="font-semibold">{t("app.name")}</span>
            <span className="text-xs text-muted-foreground">{t("app.tagline")}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => {
          const isCurrent = group.labelKey === current;
          // The current section always stays open, so the page you are on is always in view.
          const open = iconOnly || isCurrent || extra.includes(group.labelKey);
          const contentId = `nav-${group.labelKey.replace(/\W+/g, "-")}`;
          return (
            <SidebarGroup
              key={group.labelKey}
              data-current={isCurrent || undefined}
              className={cn(isCurrent && "rounded-r-lg border-l-2 border-sidebar-primary bg-sidebar-accent/50")}
            >
              <SidebarGroupLabel
                render={
                  <button
                    type="button"
                    onClick={() => !isCurrent && toggle(group.labelKey)}
                    aria-expanded={open}
                    aria-controls={contentId}
                    aria-current={isCurrent ? "location" : undefined}
                  />
                }
                className={cn(
                  "w-full justify-between gap-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isCurrent
                    ? "cursor-default font-semibold text-sidebar-primary hover:bg-transparent hover:text-sidebar-primary"
                    : "cursor-pointer"
                )}
              >
                <span className="flex items-center gap-2">
                  {isCurrent && <span aria-hidden className="size-1.5 rounded-full bg-sidebar-primary" />}
                  {t(group.labelKey)}
                </span>
                <ChevronRight
                  aria-hidden
                  className={cn("transition-transform duration-200", open && "rotate-90", isCurrent && "opacity-0")}
                />
              </SidebarGroupLabel>
              <SidebarGroupContent id={contentId} hidden={!open}>
                <SidebarMenu>
                  {group.items.filter((item) => !item.superAdmin || superAdmin).map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isNavItemActive(item.href, pathname)}
                        tooltip={t(item.key)}
                      >
                        <item.icon />
                        <span>{t(item.key)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarAccount name={user.name} email={user.email} role={user.role} tenantName={user.tenantName} envLabel={envLabel} />
      </SidebarFooter>
    </Sidebar>
  );
}
