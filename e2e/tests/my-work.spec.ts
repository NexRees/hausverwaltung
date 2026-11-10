// nexrees: colleagues hand work to each other (Meine Arbeit, tasks, comments with @mentions).
import { test, expect, type Browser, type Page } from "@playwright/test";
import { USERS, authFile, type UserKey } from "../users";
import { openPage, uniq } from "../helpers";

async function pageAs(browser: Browser, key: UserKey) {
  const context = await browser.newContext({ storageState: authFile(key) });
  return { page: await context.newPage(), close: () => context.close() };
}

/** A card on "Meine Arbeit" by its title. */
const card = (page: Page, title: string) => page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) });

async function createTask(page: Page, title: string, assignee: string) {
  await openPage(page, "/de/my-work");
  await page.getByRole("button", { name: "Aufgabe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Aufgabe", { exact: true }).fill(title);
  await dialog.getByLabel("Zuständig", { exact: true }).selectOption({ label: assignee });
  await dialog.getByLabel("Beschreibung", { exact: true }).fill("Angelegt vom E2E-Test.");
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(dialog).toBeHidden();
}

test("hand a task to a colleague, who finishes it", async ({ browser }) => {
  const title = uniq("Aufgabe übergeben");
  const vera = await pageAs(browser, "verwaltung");
  await createTask(vera.page, title, USERS.buchhaltung.name);
  await expect(card(vera.page, "Von mir übergeben").getByText(title)).toBeVisible();

  const bernd = await pageAs(browser, "buchhaltung");
  await openPage(bernd.page, "/de/my-work");
  const mine = card(bernd.page, "Meine Aufgaben");
  const row = mine.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`von ${USERS.verwaltung.name}`);
  await row.getByRole("button", { name: "Erledigt" }).click();
  await expect(mine.getByText(title)).toHaveCount(0);

  await vera.page.reload();
  await expect(card(vera.page, "Von mir übergeben").getByText(title)).toHaveCount(0);
  await vera.close();
  await bernd.close();
});

test("anyone can take an unassigned task", async ({ browser }) => {
  const title = uniq("Aufgabe offen");
  const vera = await pageAs(browser, "verwaltung");
  await createTask(vera.page, title, "Nicht zugewiesen");
  await vera.close();

  const bernd = await pageAs(browser, "buchhaltung");
  await openPage(bernd.page, "/de/my-work");
  const open = card(bernd.page, "Offen, ohne Zuständige");
  await open.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Übernehmen" }).click();
  await expect(card(bernd.page, "Meine Aufgaben").getByText(title)).toBeVisible();
  await expect(open.getByText(title)).toHaveCount(0);
  await bernd.close();
});

test("an @mention on a property shows up for the colleague", async ({ browser }) => {
  const text = uniq("Bitte prüfen");
  const vera = await pageAs(browser, "verwaltung");
  await openPage(vera.page, "/de/properties");
  await vera.page.getByRole("link", { name: "Wohnanlage Lindenstraße" }).first().click();
  const box = vera.page.getByRole("textbox", { name: "Kommentar" });
  await box.fill(`${text} @Bernd`);
  await vera.page.getByRole("option", { name: USERS.buchhaltung.name }).click();
  await vera.page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(vera.page.getByText(text).first()).toBeVisible();
  await vera.close();

  const bernd = await pageAs(browser, "buchhaltung");
  await openPage(bernd.page, "/de/my-work");
  await expect(card(bernd.page, "Erwähnungen").getByText(text)).toBeVisible();
  await bernd.close();
});
