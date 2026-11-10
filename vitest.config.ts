import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // nexrees: the Playwright specs in e2e/ run with npm run e2e, not here.
  test: { environment: "node", exclude: [...configDefaults.exclude, "e2e/tests/**", "e2e/smoke/**", "e2e/*.setup.ts"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
