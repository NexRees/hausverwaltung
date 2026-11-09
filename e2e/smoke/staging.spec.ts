// nexrees: read-only smoke test for a deployed environment (staging). Creates and changes nothing.
//   E2E_BASE_URL=https://staging.nexrees.de E2E_SMOKE_EMAIL=… E2E_SMOKE_PASSWORD=… npm run e2e:smoke
// Without E2E_SMOKE_EMAIL/PASSWORD only the signed-out checks run.
import { test, expect } from "@playwright/test";
import { failOnPageErrors, openPage, pageTitle } from "../helpers";

const email = process.env.E2E_SMOKE_EMAIL;
const password = process.env.E2E_SMOKE_PASSWORD;

test("login page is up and branded", async ({ page }) => {
  await openPage(page, "/de/login");
  await expect(page.getByRole("heading", { name: /Willkommen bei NexRees/ })).toBeVisible();
  await expect(page.getByText("HaVeWa", { exact: true })).toHaveCount(0);
});

test("data needs a login", async ({ request }) => {
  for (const path of ["/api/export/persons", "/api/statements/pdf?propertyId=x&year=2025&key=x"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(401);
  }
});

test.describe("signed in", () => {
  test.skip(!email || !password, "E2E_SMOKE_EMAIL / E2E_SMOKE_PASSWORD not set");

  test("staff login and main pages", async ({ page }) => {
    const noErrors = failOnPageErrors(page);
    await page.goto("/de/login");
    await page.getByLabel("E-Mail", { exact: true }).fill(email!);
    await page.getByLabel("Passwort", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    for (const path of ["/de/dashboard", "/de/my-work", "/de/properties", "/de/units", "/de/statements", "/de/documents"]) {
      await openPage(page, path);
      await expect(pageTitle(page), path).not.toHaveText("");
    }
    noErrors();
  });
});
