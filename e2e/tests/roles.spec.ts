// nexrees: who lands where. Staff work in the admin area; tenants and owners only get the portal.
import { test, expect } from "@playwright/test";
import { USERS, STAFF, PORTAL, authFile } from "../users";
import { openPage, pageTitle } from "../helpers";

for (const key of STAFF) {
  test.describe(`${key} (${USERS[key].role})`, () => {
    test.use({ storageState: authFile(key) });

    test("lands on the dashboard and sees the staff navigation", async ({ page }) => {
      await openPage(page, "/de");
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("link", { name: "Meine Arbeit" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Objekte" }).first()).toBeVisible();
    });
  });
}

for (const key of PORTAL) {
  test.describe(`${key} (${USERS[key].role})`, () => {
    test.use({ storageState: authFile(key) });

    test("is kept in the portal", async ({ page }) => {
      for (const path of ["/de/dashboard", "/de/properties", "/de/my-work", "/de/persons"]) {
        await page.goto(path);
        await expect(page, `${path} must redirect to the portal`).toHaveURL(/\/portal/);
      }
      await expect(page.getByText("Willkommen").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Objekte" })).toHaveCount(0);
    });
  });
}

test.describe("signed out", () => {
  test("admin pages send you to the login", async ({ page }) => {
    await page.goto("/de/properties");
    await expect(page).toHaveURL(/\/login/);
    await expect(pageTitle(page)).toBeVisible();
  });
});
