// nexrees: bulk data (CSV exports, import template) is staff-only (src/lib/staff-access.ts).
// Upstream only checked "logged in", so a tenant could download every person with IBAN.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { USERS, STAFF, PORTAL, authFile, type UserKey } from "../users";

const EXPORTS = ["persons", "tenants", "openitems", "units", "properties", "tickets"].map((x) => `/api/export/${x}`);

async function as(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, key: UserKey | null, baseURL: string) {
  return playwright.request.newContext({ baseURL, storageState: key ? authFile(key) : undefined });
}

for (const key of PORTAL) {
  test(`${key} (${USERS[key].role}) gets 403 on every export`, async ({ playwright, baseURL }) => {
    const api = await as(playwright, key, baseURL!);
    for (const path of EXPORTS) {
      const res = await api.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(403);
    }
    await api.dispose();
  });
}

for (const key of STAFF) {
  test(`${key} (${USERS[key].role}) can download every export`, async ({ playwright, baseURL }) => {
    const api = await as(playwright, key, baseURL!);
    for (const path of EXPORTS) {
      const res = await api.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"] ?? "", path).toMatch(/csv|text|octet/);
    }
    await api.dispose();
  });
}

test("signed out gets no data", async ({ playwright, baseURL }) => {
  const api = await as(playwright, null, baseURL!);
  for (const path of EXPORTS) {
    const res = await api.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(401);
  }
  await api.dispose();
});

test("the export button on the persons page downloads a CSV", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("verwaltung") });
  const page = await context.newPage();
  await page.goto("/de/persons");
  const download = page.waitForEvent("download");
  const label = /CSV/i;
  await page.getByRole("link", { name: label }).or(page.getByRole("button", { name: label })).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  await context.close();
});
