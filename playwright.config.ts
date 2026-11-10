// nexrees: end-to-end UI tests (Playwright). See e2e/README.md.
//
// Local:   npm run build && npm run e2e:seed && npm run e2e
// Against a running app (dev server, staging): E2E_BASE_URL=https://… npm run e2e:smoke
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${PORT}`;
const CI = !!process.env.CI;
// Optional: use an already installed Chromium instead of `npx playwright install chromium`.
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : [["list"]],
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { executablePath },
  },
  projects: [
    // Logs every seeded role in through the real login form once and keeps the session cookies.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "app",
      testDir: "./e2e/tests",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], locale: "de-DE", timezoneId: "Europe/Berlin", launchOptions: { executablePath } },
    },
    // Read-only checks that are safe against a deployed environment (staging). No setup project:
    // it signs in itself with the E2E_SMOKE_* credentials.
    {
      name: "smoke",
      testDir: "./e2e/smoke",
      use: { ...devices["Desktop Chrome"], locale: "de-DE", timezoneId: "Europe/Berlin", launchOptions: { executablePath } },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: `${baseURL}/de/login`,
        reuseExistingServer: !CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
