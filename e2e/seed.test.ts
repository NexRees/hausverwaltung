import { describe, expect, it } from "vitest";
import { e2eSeedAllowed } from "./seed";

describe("e2eSeedAllowed", () => {
  const local = "postgresql://postgres:postgres@localhost:5432/havewa";
  it("allows a local database", () => {
    expect(e2eSeedAllowed({ DATABASE_URL: local })).toBeNull();
    expect(e2eSeedAllowed({ DATABASE_URL: "postgresql://u:p@127.0.0.1/x", APP_ENV: "ci" })).toBeNull();
  });
  it("refuses deployed environments and remote hosts", () => {
    expect(e2eSeedAllowed({ DATABASE_URL: local, APP_ENV: "staging" })).toMatch(/staging/);
    expect(e2eSeedAllowed({ DATABASE_URL: local, APP_ENV: "production" })).toMatch(/production/);
    expect(e2eSeedAllowed({ DATABASE_URL: "postgresql://u:p@nexrees-staging.abc.eu-central-1.rds.amazonaws.com/x" })).toMatch(/nicht lokal/);
    expect(e2eSeedAllowed({})).toMatch(/DATABASE_URL/);
  });
});
