// nexrees: every page in the sidebar opens for staff without a server or browser error and shows
// its title in the top bar. Catches pages that crash after an upstream merge or a UI change.
import { test, expect } from "@playwright/test";
import { navGroups, settingsNavItem } from "../../src/lib/nav";
import { authFile } from "../users";
import { failOnPageErrors, openPage, pageTitle } from "../helpers";

test.use({ storageState: authFile("admin") });

const items = [...navGroups.flatMap((g) => g.items), settingsNavItem];

for (const item of items) {
  test(`opens ${item.href}`, async ({ page }) => {
    const noErrors = failOnPageErrors(page);
    await openPage(page, `/de${item.href}`);
    await expect(pageTitle(page)).not.toHaveText("");
    noErrors();
  });
}

test("sidebar marks the current section and page", async ({ page }) => {
  await openPage(page, "/de/units");
  // Section: aria-current="location" on its header. Page: data-active on the menu link.
  await expect(page.locator('[aria-current="location"]')).toHaveText(/Verwaltung/);
  const active = page.locator('[data-sidebar="menu-button"][data-active]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText("Einheiten");
});
