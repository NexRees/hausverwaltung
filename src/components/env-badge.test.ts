import { describe, expect, it } from "vitest";
import { envLabel } from "./env-badge";

describe("envLabel", () => {
  it("names non-production environments and hides production", () => {
    expect(envLabel("staging")).toBe("Staging");
    expect(envLabel(" Staging ")).toBe("Staging");
    expect(envLabel("development")).toBe("Entwicklung");
    expect(envLabel("demo")).toBe("Demo");
    expect(envLabel("production")).toBeNull();
    expect(envLabel("")).toBeNull();
    expect(envLabel(undefined)).toBeNull();
  });
});
