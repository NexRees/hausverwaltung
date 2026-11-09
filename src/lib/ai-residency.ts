// nexrees: data residency guard for AI calls.
//
// With DATA_RESIDENCY set (e.g. "eu-central-1"), company data may only go to an AI endpoint that
// processes it in that region:
//   - "bedrock": AWS Bedrock in exactly that region, with an in-region model id. Cross-region
//     inference profiles ("eu.", "us.", "global." ...) route requests to other regions and are
//     refused; AI_ALLOW_EU_CROSS_REGION=true allows "eu." profiles (EU regions only).
//   - "openai": only an OpenAI-compatible base URL whose host is listed in AI_ALLOWED_HOSTS
//     (e.g. our own LLM gateway in Frankfurt).
//   - "anthropic" (api.anthropic.com) and the public OpenAI API are refused.
// Without DATA_RESIDENCY the upstream behaviour is unchanged (self-hosters, local development).

export type AiProviderId = "anthropic" | "openai" | "bedrock";

export interface ResidencyInput {
  provider: AiProviderId | string | undefined;
  baseUrl?: string | null;
  model?: string | null;
  region?: string | null;
}

export type ResidencyEnv = {
  DATA_RESIDENCY?: string;
  AI_ALLOWED_HOSTS?: string;
  AI_ALLOW_EU_CROSS_REGION?: string;
};

const CROSS_REGION_PREFIX = /^(eu|us|us-gov|apac|ap|jp|au|ca|global)\./i;

/** Returns why the call is not allowed, or null when it is. Pure, for tests and the settings form. */
export function residencyViolation(input: ResidencyInput, env: ResidencyEnv = process.env as ResidencyEnv): string | null {
  const required = env.DATA_RESIDENCY?.trim();
  if (!required) return null;

  if (input.provider === "anthropic") {
    return `KI-Anbieter "Anthropic API" verarbeitet Daten außerhalb von ${required}. Bitte AWS Bedrock (${required}) oder ein freigegebenes Gateway verwenden.`;
  }

  if (input.provider === "openai") {
    if (!input.baseUrl) {
      return `Die öffentliche OpenAI-API verarbeitet Daten außerhalb von ${required}. Bitte eine freigegebene Basis-URL angeben.`;
    }
    let host: string;
    try {
      const u = new URL(input.baseUrl);
      if (u.protocol !== "https:") return "KI-Basis-URL muss HTTPS verwenden.";
      host = u.hostname.toLowerCase();
    } catch {
      return "KI-Basis-URL ist ungültig.";
    }
    const allowed = (env.AI_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(host)) {
      return `KI-Endpunkt ${host} ist für die Datenhaltung in ${required} nicht freigegeben (AI_ALLOWED_HOSTS).`;
    }
    return null;
  }

  if (input.provider !== "bedrock") return `Unbekannter KI-Anbieter "${input.provider ?? ""}".`;
  const region = input.region?.trim();
  if (region !== required) {
    return `AWS Bedrock muss in ${required} laufen (konfiguriert: ${region || "keine Region"}).`;
  }
  const model = input.model?.trim() ?? "";
  const m = CROSS_REGION_PREFIX.exec(model);
  if (m) {
    const euAllowed = env.AI_ALLOW_EU_CROSS_REGION === "true" && m[1].toLowerCase() === "eu";
    if (!euAllowed) {
      return `Modell ${model} ist ein regionsübergreifendes Inferenzprofil und kann Daten außerhalb von ${required} verarbeiten. Bitte eine Modell-ID ohne Präfix verwenden, die in ${required} angeboten wird.`;
    }
  }
  return null;
}
