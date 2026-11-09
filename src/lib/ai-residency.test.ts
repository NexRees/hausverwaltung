import { describe, it, expect } from "vitest";
import { residencyViolation } from "./ai-residency";

const FRA = { DATA_RESIDENCY: "eu-central-1" };

describe("residencyViolation", () => {
  it("allows everything when no residency is required", () => {
    expect(residencyViolation({ provider: "anthropic" }, {})).toBeNull();
    expect(residencyViolation({ provider: "openai" }, {})).toBeNull();
  });

  it("refuses the Anthropic and public OpenAI APIs", () => {
    expect(residencyViolation({ provider: "anthropic" }, FRA)).toMatch(/außerhalb von eu-central-1/);
    expect(residencyViolation({ provider: "openai" }, FRA)).toMatch(/öffentliche OpenAI-API/);
  });

  it("allows only listed HTTPS gateways for OpenAI-compatible providers", () => {
    const env = { ...FRA, AI_ALLOWED_HOSTS: "llm.nexrees.de, gw.internal" };
    expect(residencyViolation({ provider: "openai", baseUrl: "https://llm.nexrees.de/v1" }, env)).toBeNull();
    expect(residencyViolation({ provider: "openai", baseUrl: "https://openrouter.ai/api/v1" }, env)).toMatch(/nicht freigegeben/);
    expect(residencyViolation({ provider: "openai", baseUrl: "http://llm.nexrees.de/v1" }, env)).toMatch(/HTTPS/);
    expect(residencyViolation({ provider: "openai", baseUrl: "not a url" }, env)).toMatch(/ungültig/);
  });

  it("requires Bedrock in the same region with an in-region model", () => {
    const ok = { provider: "bedrock", region: "eu-central-1", model: "anthropic.claude-sonnet-4-5-20250929-v1:0" };
    expect(residencyViolation(ok, FRA)).toBeNull();
    expect(residencyViolation({ ...ok, region: "eu-west-1" }, FRA)).toMatch(/muss in eu-central-1/);
    expect(residencyViolation({ ...ok, region: undefined }, FRA)).toMatch(/keine Region/);
  });

  it("refuses cross-region inference profiles unless EU profiles are explicitly allowed", () => {
    const base = { provider: "bedrock", region: "eu-central-1" };
    for (const model of ["eu.anthropic.claude-x", "global.anthropic.claude-x", "us.anthropic.claude-x", "apac.anthropic.claude-x"]) {
      expect(residencyViolation({ ...base, model }, FRA)).toMatch(/regionsübergreifend/);
    }
    const euOk = { ...FRA, AI_ALLOW_EU_CROSS_REGION: "true" };
    expect(residencyViolation({ ...base, model: "eu.anthropic.claude-x" }, euOk)).toBeNull();
    expect(residencyViolation({ ...base, model: "global.anthropic.claude-x" }, euOk)).toMatch(/regionsübergreifend/);
  });

  it("refuses unknown providers", () => {
    expect(residencyViolation({ provider: "mystery" }, FRA)).toMatch(/Unbekannter/);
  });
});
