// nexrees: signs every seeded role in through the real login form and stores the session, so the
// tests start logged in. This is also the login test for each role.
import { test as setup, expect } from "@playwright/test";
import { USERS, authFile, type UserKey } from "./users";

for (const key of Object.keys(USERS) as UserKey[]) {
  const u = USERS[key];
  setup(`login as ${key} (${u.role})`, async ({ page }) => {
    await page.goto("/de/login");
    await page.getByLabel("E-Mail", { exact: true }).fill(u.email);
    await page.getByLabel("Passwort", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL(u.home === "portal" ? /\/portal(\/|$)/ : /\/dashboard(\/|$)/);
    await page.context().storageState({ path: authFile(key) });
  });
}

setup("wrong password is refused", async ({ page }) => {
  await page.goto("/de/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(USERS.admin.email);
  await page.getByLabel("Passwort", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("E-Mail oder Passwort")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
