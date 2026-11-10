// nexrees: the core records. Staff create a property, find it, open it; units are listed, paged
// and searchable (src/lib/list-params.ts).
import { test, expect } from "@playwright/test";
import { authFile } from "../users";
import { openPage, pageTitle, uniq } from "../helpers";

test.use({ storageState: authFile("verwaltung") });

test("seeded property shows its buildings and units", async ({ page }) => {
  await openPage(page, "/de/properties");
  await page.getByRole("link", { name: "Wohnanlage Lindenstraße" }).first().click();
  await expect(pageTitle(page)).toHaveText("Wohnanlage Lindenstraße");
  await expect(page.getByText("EG links").first()).toBeVisible();
  await expect(page.getByText("Stellplatz 1").first()).toBeVisible();
});

test("create a property and open it", async ({ page }) => {
  const name = uniq("Objekt");
  await openPage(page, "/de/properties");
  await page.getByRole("button", { name: "Neues Objekt" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Straße", { exact: true }).fill("Teststraße 1");
  await dialog.getByLabel("PLZ", { exact: true }).fill("60311");
  await dialog.getByLabel("Ort", { exact: true }).fill("Frankfurt am Main");
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(dialog).toBeHidden();

  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  await link.click();
  await expect(pageTitle(page)).toHaveText(name);
});

test("units list searches by label", async ({ page }) => {
  await openPage(page, "/de/units");
  const search = page.getByRole("textbox", { name: "Suchen" });
  await search.fill("Stellplatz");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=Stellplatz/);
  const rows = page.getByRole("row");
  await expect(rows.filter({ hasText: "Stellplatz 1" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "EG links" })).toHaveCount(0);
});

test("unit detail opens from the list", async ({ page }) => {
  await openPage(page, "/de/units?q=EG%20links");
  await page.getByRole("link", { name: "EG links" }).first().click();
  await expect(page).toHaveURL(/\/units\/[^/?]+/);
  await expect(pageTitle(page)).toContainText("EG links");
});
