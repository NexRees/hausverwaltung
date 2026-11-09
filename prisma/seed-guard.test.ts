import { describe, expect, it } from "vitest";
import { seedAllowed } from "./seed-guard";

describe("seedAllowed", () => {
  it("runs on staging, whose container has NODE_ENV=production", () => {
    expect(seedAllowed({ NODE_ENV: "production", APP_ENV: "staging" })).toBe(true);
  });
  it("runs locally", () => {
    expect(seedAllowed({})).toBe(true);
    expect(seedAllowed({ NODE_ENV: "development" })).toBe(true);
  });
  it("refuses production, and a production build that does not say where it runs", () => {
    expect(seedAllowed({ NODE_ENV: "production", APP_ENV: "production" })).toBe(false);
    expect(seedAllowed({ APP_ENV: "production" })).toBe(false);
    expect(seedAllowed({ NODE_ENV: "production" })).toBe(false);
  });
});
