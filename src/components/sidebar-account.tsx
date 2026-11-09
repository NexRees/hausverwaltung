"use client";

// nexrees: settings, theme and the account menu at the bottom of the sidebar, the way most
// SaaS apps place them, instead of icons in the top bar.
import { useState } from "react";
import { ChevronsUpDown, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { settingsNavItem } from "@/lib/nav";
import { isNavItemActive } from "@/lib/nav-active";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { initials } from "@/components/user-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

const THEMES = [
  { value: "light", key: "common.themeLight", icon: Sun },
  { value: "dark", key: "common.themeDark", icon: Moon },
  { value: "system", key: "common.themeSystem", icon: Monitor },
] as const;

export function SidebarAccount({
  name,
  email,
  role,
}: {
  name?: string | null;
  email?: string | null;
  role: string;
}) {
  const t = useTranslations();
  const locale = useLocale(); // stay in the same language after signing out
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { isMobile } = useSidebar();
  const [pwOpen, setPwOpen] = useState(false);
  const Settings = settingsNavItem.icon;

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            render={<Link href={settingsNavItem.href} />}
            isActive={isNavItemActive(settingsNavItem.href, pathname)}
          >
            <Settings />
            <span>{t(settingsNavItem.key)}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                />
              }
            >
              <Avatar className="size-8">
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={8}
              className="w-60"
            >
              <DropdownMenuLabel>
                <div className="grid">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">{t(`userRole.${role}`)}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t("common.theme")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                  {THEMES.map(({ value, key, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                      <Icon className="size-4" />
                      {t(key)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPwOpen(true)}>
                <KeyRound className="size-4" />
                {t("account.changePassword")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: `/${locale}/login` })}>
                <LogOut className="size-4" />
                {t("common.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}
