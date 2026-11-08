import { describe, it, expect } from "vitest";
import { Building2 } from "lucide-react";
import { activeNavGroup, isNavItemActive } from "./nav-active";
import { navGroups, type NavGroup } from "./nav";

describe("isNavItemActive", () => {
  it("matches the entry and pages below it", () => {
    expect(isNavItemActive("/leases", "/leases")).toBe(true);
    expect(isNavItemActive("/leases", "/leases/abc/edit")).toBe(true);
  });
  it("does not match another entry that only shares a prefix", () => {
    expect(isNavItemActive("/leases", "/leasing")).toBe(false);
  });
  it("matches / only exactly", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/units")).toBe(false);
  });
});

describe("activeNavGroup", () => {
  it("finds the section of the current page", () => {
    expect(activeNavGroup(navGroups, "/dunning/42")).toBe("nav.groupFinance");
    expect(activeNavGroup(navGroups, "/leasing")).toBe("nav.groupManagement");
    expect(activeNavGroup(navGroups, "/settings/users")).toBe("nav.groupAdmin");
  });
  it("is null outside every section", () => {
    expect(activeNavGroup(navGroups, "/profile")).toBeNull();
  });
  it("takes the first section when two would match", () => {
    const groups: NavGroup[] = [
      { labelKey: "a", items: [{ key: "x", href: "/x", icon: Building2 }] },
      { labelKey: "b", items: [{ key: "y", href: "/x", icon: Building2 }] },
    ];
    expect(activeNavGroup(groups, "/x")).toBe("a");
  });
});
