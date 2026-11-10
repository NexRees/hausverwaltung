// nexrees: Betriebskostenabrechnung. The seed has 2025 costs for "Wohnanlage Lindenstraße"; each
// lease row links to its itemised PDF letter (src/server/statement-pdf.ts).
import { test, expect } from "@playwright/test";
import { authFile } from "../users";
import { openPage } from "../helpers";

const YEAR = 2025;

test.describe("staff", () => {
  test.use({ storageState: authFile("buchhaltung") });

  test("opens the statement and downloads a tenant's PDF", async ({ page, request }) => {
    await openPage(page, "/de/statements");
    // The selector labels are not linked to their <select> (no htmlFor), so select by name.
    await page.locator('select[name="propertyId"]').selectOption({ label: "Wohnanlage Lindenstraße" });
    await page.locator('select[name="year"]').selectOption(String(YEAR));
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`year=${YEAR}`));

    const pdfLink = page.getByRole("link", { name: "Abrechnung als PDF" }).first();
    await expect(pdfLink).toBeVisible();
    const href = await pdfLink.getAttribute("href");
    expect(href).toContain("/api/statements/pdf");

    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(2_000);
  });
});

test.describe("portal", () => {
  test.use({ storageState: authFile("mieter") });

  test("a tenant cannot fetch statement PDFs", async ({ request }) => {
    const res = await request.get(`/api/statements/pdf?propertyId=x&year=${YEAR}&key=x`);
    expect(res.status()).toBe(403);
  });
});
