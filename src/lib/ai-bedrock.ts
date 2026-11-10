import "server-only";
import { createHash, createHmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

// nexrees: AWS Bedrock Converse API, signed with the ECS task role (no API key stored anywhere).
// The region is passed in by src/lib/ai.ts after the residency guard has checked it.

class Sha256 {
  private h;
  constructor(secret?: string | Uint8Array | ArrayBuffer | ArrayBufferView) {
    this.h = secret
      ? createHmac("sha256", typeof secret === "string" ? secret : Buffer.from(secret as Uint8Array))
      : createHash("sha256");
  }
  update(data: string | Uint8Array | ArrayBuffer | ArrayBufferView): void {
    this.h.update(typeof data === "string" ? data : Buffer.from(data as Uint8Array));
  }
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.h.digest());
  }
}

const credentials = defaultProvider();

export interface ConverseInput {
  region: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

interface ConverseOutput {
  output?: { message?: { content?: { text?: string }[] } };
  message?: string;
}

export async function bedrockConverse(input: ConverseInput): Promise<string> {
  const host = `bedrock-runtime.${input.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(input.model)}/converse`;
  const body = JSON.stringify({
    system: [{ text: input.system }],
    messages: [{ role: "user", content: [{ text: input.user }] }],
    inferenceConfig: { maxTokens: input.maxTokens },
  });

  const signer = new SignatureV4({ service: "bedrock", region: input.region, credentials, sha256: Sha256 });
  const signed = await signer.sign({
    method: "POST",
    protocol: "https:",
    hostname: host,
    path,
    headers: { host, "content-type": "application/json", accept: "application/json" },
    body,
  });

  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: signed.headers as Record<string, string>,
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as ConverseOutput;
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${json.message ?? res.statusText}`);
  return (json.output?.message?.content ?? [])
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
}
