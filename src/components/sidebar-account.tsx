"use client";

// nexrees: the account menu at the bottom of the sidebar, the way most SaaS apps place it.
// It holds everything personal or app-wide that used to sit in the top bar: settings, about,
// language, theme, password, sign out and the app version.
import { useState } from "react";
import { ChevronsUpDown, Info, KeyRound, Languages, LogOut, Monitor, Moon, Palette, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, localeLabels } from "@/i18n/routing";
import { settingsNavItem } from "@/lib/nav";
import { isNavItemActive } from "@/lib/nav-active";
import { APP_VERSION_FULL, APP_VERSION_LABEL } from "@/lib/version";
import { BRAND } from "@/lib/brand";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { InfoDrawer } from "@/components/info-drawer";
import { initials } from "@/components/user-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  tenantName,
  envLabel,
}: {
  name?: string | null;
  email?: string | null;
  role: string;
  tenantName: string;
  /** Environment name from APP_ENV (e.g. "Staging"); null in production. */
  envLabel?: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();
  const [pwOpen, setPwOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const Settings = settingsNavItem.icon;
  const onSettings = isNavItemActive(settingsNavItem.href, pathname);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  isActive={onSettings}
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
              <DropdownMenuItem
                onClick={() => {
                  setOpenMobile(false);
                  router.push(settingsNavItem.href);
                }}
              >
                <Settings className="size-4" />
                {t(settingsNavItem.key)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAboutOpen(true)}>
                <Info className="size-4" />
                {t("about.title")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Languages className="size-4" />
                  {t("common.language")}
                  <span className="ml-auto text-xs text-muted-foreground">{localeLabels[locale as keyof typeof localeLabels]}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={locale}
                    onValueChange={(l) => router.replace(pathname, { locale: String(l) as (typeof routing.locales)[number] })}
                  >
                    {routing.locales.map((l) => (
                      <DropdownMenuRadioItem key={l} value={l} closeOnClick>
                        {localeLabels[l]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette className="size-4" />
                  {t("common.theme")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                    {THEMES.map(({ value, key, icon: Icon }) => (
                      <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                        <Icon className="size-4" />
                        {t(key)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPwOpen(true)}>
                <KeyRound className="size-4" />
                {t("account.changePassword")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: `/${locale}/login` })}>
                <LogOut className="size-4" />
                {t("common.logout")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground" title={APP_VERSION_FULL}>
                <span>
                  {BRAND.name} {APP_VERSION_LABEL}
                </span>
                {envLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    {envLabel}
                  </span>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <InfoDrawer tenantName={tenantName} open={aboutOpen} onOpenChange={setAboutOpen} hideTrigger />
    </>
  );
}
