import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { BRAND } from "@/lib/brand";
import { openSecret } from "@/lib/crypto";
import { residencyViolation, type AiProviderId } from "@/lib/ai-residency";
import { bedrockConverse } from "@/lib/ai-bedrock";

// KI-Adapter. Unterstützt Anthropic (Claude) und beliebige OpenAI-kompatible
// Anbieter (OpenAI, OpenRouter → Hermes/Llama/…, Groq, Ollama, LM Studio …)
// über Basis-URL. Config kommt aus der Mandanten-Konfiguration, fällt sonst auf
// Umgebungsvariablen zurück. Ohne Schlüssel liefern die Aufrufer eine
// regelbasierte Antwort — die App läuft voll.

// nexrees: third provider "bedrock" (AWS Bedrock, credentials from the task role) and a data
// residency guard (src/lib/ai-residency.ts) that every call passes through.
export type AiProvider = AiProviderId;

export interface AiConfig {
  provider?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}

export function resolveProvider(cfg?: AiConfig): AiProvider {
  if (cfg?.provider === "openai" || cfg?.provider === "anthropic" || cfg?.provider === "bedrock") return cfg.provider;
  if (cfg?.baseUrl) return "openai";
  const env = process.env.AI_PROVIDER;
  if (env === "bedrock" || env === "openai" || env === "anthropic") return env;
  return "anthropic";
}
function resolveKey(cfg?: AiConfig): string | undefined {
  // nexrees: tenant keys are stored encrypted (openSecret also reads legacy plaintext)
  return openSecret(cfg?.apiKey) || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || undefined;
}
function resolveModel(cfg?: AiConfig): string {
  if (cfg?.model) return cfg.model;
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  const p = resolveProvider(cfg);
  if (p === "bedrock") throw new Error("Für AWS Bedrock ist eine Modell-ID nötig (Einstellungen → KI oder AI_MODEL).");
  return p === "openai" ? "gpt-4o-mini" : "claude-opus-4-8";
}
function bedrockRegion(): string | undefined {
  return process.env.AI_BEDROCK_REGION || process.env.AWS_REGION || undefined;
}

export function isAiConfigured(cfg?: AiConfig): boolean {
  if (resolveProvider(cfg) === "bedrock") return !!bedrockRegion(); // credentials come from the task role
  return !!resolveKey(cfg);
}

/** nexrees: why this configuration may not receive company data, or null. Used by settings too. */
export function aiResidencyProblem(cfg?: AiConfig): string | null {
  return residencyViolation({
    provider: resolveProvider(cfg),
    baseUrl: cfg?.baseUrl,
    model: cfg?.model || process.env.AI_MODEL,
    region: bedrockRegion(),
  });
}

/** nexrees: label shown with every AI answer (EU AI Act Art. 50: say that text is machine-made). */
export function aiSourceLabel(cfg?: AiConfig): string {
  const p = resolveProvider(cfg);
  let where = p === "bedrock" ? `AWS Bedrock ${bedrockRegion() ?? ""}`.trim() : p === "openai" ? "OpenAI" : "Anthropic";
  if (p === "openai" && cfg?.baseUrl) {
    try {
      where = new URL(cfg.baseUrl).host;
    } catch {
      /* invalid URL: the residency guard reports it */
    }
  }
  let model = "";
  try {
    model = resolveModel(cfg);
  } catch {
    /* no model configured */
  }
  return `KI-generiert · ${where}${model ? ` · ${model}` : ""} · bitte prüfen`;
}

async function chat(cfg: AiConfig, user: string, maxTokens: number): Promise<string> {
  const problem = aiResidencyProblem(cfg);
  if (problem) throw new Error(problem);
  const provider = resolveProvider(cfg);
  if (provider === "bedrock") {
    return bedrockConverse({ region: bedrockRegion()!, model: resolveModel(cfg), system: SYSTEM, user, maxTokens });
  }
  const apiKey = resolveKey(cfg);
  if (!apiKey) throw new Error("Kein API-Schlüssel konfiguriert");
  return provider === "openai" ? openaiChat(cfg, apiKey, user, maxTokens) : anthropicChat(cfg, apiKey, user, maxTokens);
}

const SYSTEM = `Du bist der Assistent einer deutschen Hausverwaltungssoftware (${BRAND.name}).
Beantworte Fragen zum verwalteten Immobilienbestand knapp, sachlich und auf Deutsch.
Stütze dich ausschließlich auf die im Kontext gelieferten Daten; erfinde keine Zahlen.
Wenn die Daten für eine Antwort nicht ausreichen, sage das offen.`;

async function anthropicChat(cfg: AiConfig, apiKey: string, user: string, maxTokens: number): Promise<string> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: resolveModel(cfg),
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function openaiChat(cfg: AiConfig, apiKey: string, user: string, maxTokens: number): Promise<string> {
  const client = new OpenAI({ apiKey, baseURL: cfg.baseUrl || undefined });
  const res = await client.chat.completions.create({
    model: resolveModel(cfg),
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

/** Frage an die KI, angereichert mit einem Bestands-Kontext. */
export async function askAssistant(context: string, question: string, cfg?: AiConfig): Promise<string> {
  const user = `Bestands-Kontext (JSON):\n${context}\n\nFrage: ${question}`;
  return chat(cfg ?? {}, user, 1024);
}

/** Test-Aufruf für die Einstellungen: kurze Anfrage, wirft bei Fehler. */
export async function pingAi(cfg: AiConfig): Promise<string> {
  return chat(cfg, "Antworte nur mit: OK", 16);
}
