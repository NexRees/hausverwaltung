import type { NavGroup } from "@/lib/nav";

// nexrees: which menu entry and which sidebar section belong to the current page.
// A path matches an entry on the entry itself or below it ("/leases/123"), never on a
// mere prefix of another word ("/leasing" is not "/leases").
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** labelKey of the section that holds the current page, or null when none does. */
export function activeNavGroup(groups: NavGroup[], pathname: string): string | null {
  return groups.find((g) => g.items.some((i) => isNavItemActive(i.href, pathname)))?.labelKey ?? null;
}
