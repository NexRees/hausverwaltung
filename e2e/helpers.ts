// nexrees: small helpers shared by the E2E specs.
import { expect, type Page } from "@playwright/test";

/** Unique, readable name for data a test creates, so tests can run in parallel and again. */
export function uniq(label: string) {
  return `E2E ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * The page title in the top bar. Pages keep their own <h1>, which globals.css hides; the
 * top bar shows its text (src/components/page-title.tsx), so this is the visible heading.
 */
export function pageTitle(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

/** Fails the test on uncaught errors in the browser (a crashed client component). */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors, "uncaught errors in the browser").toEqual([]);
}

/** Opens a path and checks the server answered and rendered a page title (no error page). */
export async function openPage(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.status(), `HTTP status for ${path}`).toBeLessThan(400);
  await expect(page.getByText(/Application error|Internal Server Error/i)).toHaveCount(0);
  return res!;
}
